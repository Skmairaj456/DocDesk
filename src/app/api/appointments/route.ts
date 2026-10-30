import { AppointmentSource, AppointmentStatus, ClinicRole, FollowUpStatus, FollowUpType, Prisma, VisitType } from "@prisma/client";
import { z } from "zod";
import { AuthenticationError, requireClinicUser, type ClinicContext } from "@/lib/auth";
import { withClinic } from "@/lib/tenant-db";
import { clinicLocalDate, localDayBounds, localScheduleTime } from "@/lib/booking-time.mjs";

const appointmentInput = z.object({
  patientId: z.string().uuid(),
  departmentId: z.string().uuid(),
  doctorId: z.string().uuid(),
  followUpId: z.string().uuid().optional(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  visitType: z.nativeEnum(VisitType).default(VisitType.CONSULTATION),
});

class FollowUpBookingConflict extends Error {}

const listQuery = z.object({
  range: z.enum(["upcoming", "week", "past", "custom"]).default("upcoming"),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  q: z.string().trim().max(100).optional(),
  doctorId: z.string().uuid().optional(),
  status: z.nativeEnum(AppointmentStatus).optional(),
  source: z.nativeEnum(AppointmentSource).optional(),
  page: z.coerce.number().int().min(0).max(1000).default(0),
});
const listPageSize = 50;

// Appointments across any dates, for the reception "All appointments" view.
async function listAppointments(context: ClinicContext, searchParams: URLSearchParams) {
  const parsed = listQuery.safeParse(Object.fromEntries([...searchParams].filter(([, value]) => value !== "")));
  if (!parsed.success) return Response.json({ error: "Invalid appointment filters." }, { status: 400 });
  const filters = parsed.data;
  return withClinic(context, async (tx) => {
    const clinic = await tx.clinic.findUnique({ where: { id: context.clinicId }, select: { timezone: true } });
    if (!clinic) return Response.json({ error: "Clinic was not found." }, { status: 404 });
    const today = clinicLocalDate(new Date(), clinic.timezone);
    const todayStart = localDayBounds(today, clinic.timezone).start;
    let startsAt: Prisma.DateTimeFilter;
    if (filters.range === "custom") {
      if (!filters.from || !filters.to || filters.to < filters.from) {
        return Response.json({ error: "Choose a start and end date." }, { status: 400 });
      }
      startsAt = { gte: localDayBounds(filters.from, clinic.timezone).start, lt: localDayBounds(filters.to, clinic.timezone).end };
    } else if (filters.range === "week") {
      startsAt = { gte: todayStart, lt: new Date(todayStart.valueOf() + 7 * 86_400_000) };
    } else if (filters.range === "past") {
      startsAt = { lt: todayStart };
    } else {
      startsAt = { gte: todayStart };
    }
    const digits = filters.q?.replace(/\D/g, "") ?? "";
    const rows = await tx.appointment.findMany({
      where: {
        clinicId: context.clinicId,
        startsAt,
        ...(context.doctorProfileId ? { doctorId: context.doctorProfileId } : filters.doctorId ? { doctorId: filters.doctorId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.source ? { source: filters.source } : {}),
        ...(filters.q
          ? {
              OR: [
                { reference: { contains: filters.q, mode: "insensitive" } },
                { patient: { normalizedName: { contains: filters.q.toLocaleLowerCase(), mode: "insensitive" } } },
                ...(digits.length >= 3 ? [{ patient: { normalizedPhone: { contains: digits } } }] : []),
              ],
            }
          : {}),
      },
      select: {
        id: true,
        reference: true,
        startsAt: true,
        endsAt: true,
        status: true,
        visitType: true,
        source: true,
        patient: { select: { id: true, fullName: true, phone: true } },
        doctor: { select: { membership: { select: { user: { select: { displayName: true } } } } } },
        department: { select: { name: true } },
      },
      orderBy: { startsAt: filters.range === "past" ? "desc" : "asc" },
      skip: filters.page * listPageSize,
      take: listPageSize + 1,
    });
    return Response.json({ appointments: rows.slice(0, listPageSize), hasMore: rows.length > listPageSize });
  });
}

export async function GET(request: Request) {
  try {
    const context = await requireClinicUser();
    const searchParams = new URL(request.url).searchParams;
    // Newest bookings for any visit date, so WhatsApp bookings for later days are not hidden behind the day view.
    if (searchParams.get("recent") === "1") {
      const appointments = await withClinic(context, (tx) =>
        tx.appointment.findMany({
          where: {
            clinicId: context.clinicId,
            createdAt: { gte: new Date(Date.now() - 3 * 86_400_000) },
            ...(context.doctorProfileId ? { doctorId: context.doctorProfileId } : {}),
          },
          select: {
            id: true,
            reference: true,
            startsAt: true,
            endsAt: true,
            status: true,
            visitType: true,
            source: true,
            createdAt: true,
            patient: { select: { id: true, fullName: true } },
            doctor: { select: { membership: { select: { user: { select: { displayName: true } } } } } },
            department: { select: { name: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 20,
        }),
      );
      return Response.json({ appointments });
    }
    if (searchParams.get("list") === "1") return await listAppointments(context, searchParams);
    const date = searchParams.get("date");
    const to = searchParams.get("to");
    if ((date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to))) {
      return Response.json({ error: "Use a valid YYYY-MM-DD date." }, { status: 400 });
    }
    const clinic = await withClinic(context, (tx) =>
      tx.clinic.findUnique({ where: { id: context.clinicId }, select: { timezone: true } }),
    );
    if (!clinic) return Response.json({ error: "Clinic was not found." }, { status: 404 });
    const day = date ?? clinicLocalDate(new Date(), clinic.timezone);
    const parsedDay = new Date(`${day}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      Number.isNaN(parsedDay.valueOf()) ||
      parsedDay.toISOString().slice(0, 10) !== day
    ) {
      return Response.json({ error: "Use a valid YYYY-MM-DD date." }, { status: 400 });
    }
    let bounds: { start: Date; end: Date };
    try {
      bounds = localDayBounds(day, clinic.timezone);
      if (to) {
        const lastDay = new Date(`${to}T00:00:00Z`);
        const spanDays = (lastDay.valueOf() - parsedDay.valueOf()) / 86_400_000;
        if (Number.isNaN(lastDay.valueOf()) || lastDay.toISOString().slice(0, 10) !== to || spanDays < 0 || spanDays > 31) {
          return Response.json({ error: "Use a date range of at most 31 days." }, { status: 400 });
        }
        bounds = { start: bounds.start, end: localDayBounds(to, clinic.timezone).end };
      }
    } catch (error) {
      console.error("Clinic timezone is invalid", error);
      return Response.json({ error: "The clinic timezone is not configured correctly." }, { status: 500 });
    }
    const appointments = await withClinic(context, (tx) =>
      tx.appointment.findMany({
        where: {
          clinicId: context.clinicId,
          startsAt: { gte: bounds.start, lt: bounds.end },
          ...(context.doctorProfileId
            ? { doctorId: context.doctorProfileId, status: { not: AppointmentStatus.CANCELLED } }
            : {}),
        },
        select: {
          id: true,
          reference: true,
          startsAt: true,
          endsAt: true,
          status: true,
          visitType: true,
          patient: { select: { id: true, fullName: true } },
          doctor: { select: { membership: { select: { user: { select: { displayName: true } } } } } },
          department: { select: { name: true } },
        },
        orderBy: { startsAt: "asc" },
      }),
    );
    return Response.json({ appointments });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("Appointment list failed", error);
    return Response.json({ error: "Unable to load appointments." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireClinicUser([ClinicRole.ADMIN, ClinicRole.RECEPTIONIST, ClinicRole.DOCTOR]);
    const parsed = appointmentInput.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: "Invalid appointment details.", details: parsed.error.flatten() }, { status: 400 });
    }
    const startsAt = new Date(parsed.data.startsAt);
    const endsAt = new Date(parsed.data.endsAt);
    if (startsAt <= new Date() || endsAt <= startsAt) {
      return Response.json({ error: "Choose a future start time and a later end time." }, { status: 400 });
    }
    if (
      context.role === ClinicRole.DOCTOR &&
      (parsed.data.doctorId !== context.doctorProfileId ||
        !parsed.data.followUpId ||
        !([VisitType.FOLLOW_UP, VisitType.REVISION] as VisitType[]).includes(parsed.data.visitType))
    ) {
      return Response.json({ error: "Doctors may only book their own open follow-up or revision." }, { status: 403 });
    }
    if (context.role !== ClinicRole.DOCTOR && parsed.data.followUpId) {
      return Response.json({ error: "Only a doctor may book a follow-up from the doctor workspace." }, { status: 403 });
    }

    const result = await withClinic(context, async (tx) => {
      const [clinic, patient, department, doctor, followUp] = await Promise.all([
        tx.clinic.findUnique({ where: { id: context.clinicId }, select: { timezone: true } }),
        tx.patient.findFirst({ where: { id: parsed.data.patientId, clinicId: context.clinicId }, select: { id: true } }),
        tx.department.findFirst({ where: { id: parsed.data.departmentId, clinicId: context.clinicId, isActive: true }, select: { id: true } }),
        tx.doctorProfile.findFirst({
          where: {
            id: parsed.data.doctorId,
            clinicId: context.clinicId,
            departments: { some: { departmentId: parsed.data.departmentId } },
          },
          select: {
            id: true,
            consultationMinutes: true,
            availability: { where: { isAvailable: true }, select: { weekday: true, startsAt: true, endsAt: true } },
            exceptions: { where: { isAvailable: false, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } }, select: { id: true } },
          },
        }),
        parsed.data.followUpId
          ? tx.followUp.findFirst({
              where: {
                id: parsed.data.followUpId,
                clinicId: context.clinicId,
                patientId: parsed.data.patientId,
                departmentId: parsed.data.departmentId,
                responsibleDoctorId: context.doctorProfileId ?? "",
                status: FollowUpStatus.OPEN,
              },
              select: { id: true, type: true, dueAt: true },
            })
          : Promise.resolve(null),
      ]);
      if (!clinic || !patient || !department || !doctor) {
        return { error: "The patient, department or doctor is unavailable in this clinic." as const };
      }
      if (Math.round((endsAt.valueOf() - startsAt.valueOf()) / 60_000) !== doctor.consultationMinutes) {
        return { error: `This doctor books ${doctor.consultationMinutes}-minute visits.` as const };
      }
      const localStart = localScheduleTime(startsAt, clinic.timezone);
      const localEnd = localScheduleTime(endsAt, clinic.timezone);
      const hasWorkingHours = doctor.availability.some((slot) =>
        slot.weekday === localStart.weekday &&
        localEnd.weekday === localStart.weekday &&
        slot.startsAt <= localStart.time &&
        slot.endsAt >= localEnd.time,
      );
      if (!hasWorkingHours || doctor.exceptions.length > 0) {
        return { error: "The selected time is outside this doctor’s availability." as const };
      }
      if (parsed.data.followUpId && !followUp) {
        return { error: "This follow-up is no longer open or does not belong to this patient." as const };
      }
      if (followUp && clinicLocalDate(startsAt, clinic.timezone) < clinicLocalDate(followUp.dueAt, clinic.timezone)) {
        return { error: "The appointment must be on or after the requested follow-up date." as const };
      }
      if (
        followUp &&
        ((followUp.type === FollowUpType.FOLLOW_UP && parsed.data.visitType !== VisitType.FOLLOW_UP) ||
          (followUp.type === FollowUpType.REVISION && parsed.data.visitType !== VisitType.REVISION))
      ) {
        return { error: "The visit type does not match the follow-up request." as const };
      }

      const reference = `DD-${crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
      const appointment = await tx.appointment.create({
        data: {
          clinicId: context.clinicId,
          reference,
          patientId: patient.id,
          departmentId: department.id,
          doctorId: doctor.id,
          startsAt,
          endsAt,
          visitType: parsed.data.visitType,
        },
        select: { id: true, reference: true, startsAt: true, endsAt: true, status: true },
      });
      await tx.scheduleBlock.create({
        data: {
          clinicId: context.clinicId,
          doctorId: doctor.id,
          startsAt,
          endsAt,
          appointmentId: appointment.id,
        },
      });
      if (followUp) {
        const claimed = await tx.followUp.updateMany({
          where: { id: followUp.id, status: FollowUpStatus.OPEN, bookedAppointmentId: null },
          data: { status: FollowUpStatus.BOOKED, bookedAppointmentId: appointment.id },
        });
        if (claimed.count !== 1) throw new FollowUpBookingConflict();
      }
      await tx.auditLog.create({
        data: {
          clinicId: context.clinicId,
          userId: context.userId,
          action: "APPOINTMENT_BOOKED",
          entity: "Appointment",
          entityId: appointment.id,
        },
      });
      return { appointment };
    });
    if ("error" in result) return Response.json({ error: result.error }, { status: 409 });
    return Response.json({ appointment: result.appointment }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof FollowUpBookingConflict) {
      return Response.json({ error: "This follow-up has already been booked. Refresh the task list." }, { status: 409 });
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2004" || error.code === "P2034")
    ) {
      return Response.json({ error: "That time is no longer available. Choose another slot." }, { status: 409 });
    }
    console.error("Appointment booking failed", error);
    return Response.json({ error: "Unable to book the appointment." }, { status: 500 });
  }
}
