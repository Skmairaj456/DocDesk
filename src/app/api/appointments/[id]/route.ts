import { AppointmentStatus, ClinicRole, FollowUpStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { AuthenticationError, requireClinicUser } from "@/lib/auth";
import { withClinic } from "@/lib/tenant-db";
import { localScheduleTime } from "@/lib/booking-time.mjs";

const updateInput = z.object({
  status: z.enum(["ARRIVED", "IN_CONSULTATION", "COMPLETED", "CANCELLED"]),
  cancelReason: z.string().trim().max(250).optional(),
});
const rescheduleInput = z.object({
  action: z.literal("reschedule"),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
});
const cancelInput = z.object({ reason: z.string().trim().max(250).optional() });

const allowedTransitions: Record<AppointmentStatus, AppointmentStatus[]> = {
  BOOKED: [AppointmentStatus.ARRIVED, AppointmentStatus.CANCELLED],
  ARRIVED: [AppointmentStatus.IN_CONSULTATION, AppointmentStatus.CANCELLED],
  IN_CONSULTATION: [],
  COMPLETED: [],
  CANCELLED: [],
};

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireClinicUser();
    const { id } = await params;
    const body = await request.json();
    const reschedule = rescheduleInput.safeParse(body);
    if (reschedule.success) {
      if (context.role !== ClinicRole.DOCTOR || !context.doctorProfileId) {
        return Response.json({ error: "Only the assigned doctor can reschedule this appointment." }, { status: 403 });
      }
      const doctorProfileId = context.doctorProfileId;
      const startsAt = new Date(reschedule.data.startsAt);
      const endsAt = new Date(reschedule.data.endsAt);
      if (startsAt <= new Date() || endsAt <= startsAt) {
        return Response.json({ error: "Choose a future start time and a later end time." }, { status: 400 });
      }

      const result = await withClinic(context, async (tx) => {
        const appointment = await tx.appointment.findFirst({
          where: {
            id,
            clinicId: context.clinicId,
            doctorId: doctorProfileId,
            status: { in: [AppointmentStatus.BOOKED, AppointmentStatus.ARRIVED] },
          },
          select: { id: true, startsAt: true, endsAt: true, status: true },
        });
        if (!appointment) {
          return { error: "Only a booked or checked-in appointment assigned to you can be rescheduled." as const, status: 409 };
        }
        if (endsAt.valueOf() - startsAt.valueOf() !== appointment.endsAt.valueOf() - appointment.startsAt.valueOf()) {
          return { error: "The rescheduled appointment must keep its original duration." as const, status: 400 };
        }

        const [clinic, doctor] = await Promise.all([
          tx.clinic.findUnique({ where: { id: context.clinicId }, select: { timezone: true } }),
          tx.doctorProfile.findFirst({
            where: { id: doctorProfileId, clinicId: context.clinicId },
            select: {
              availability: { where: { isAvailable: true }, select: { weekday: true, startsAt: true, endsAt: true } },
              exceptions: { where: { isAvailable: false, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } }, select: { id: true } },
            },
          }),
        ]);
        if (!clinic || !doctor) return { error: "The doctor schedule is unavailable." as const, status: 409 };

        let localStart: ReturnType<typeof localScheduleTime>;
        let localEnd: ReturnType<typeof localScheduleTime>;
        try {
          localStart = localScheduleTime(startsAt, clinic.timezone);
          localEnd = localScheduleTime(endsAt, clinic.timezone);
        } catch {
          return { error: "The clinic timezone is not configured correctly." as const, status: 500 };
        }
        const hasWorkingHours = doctor.availability.some((slot) =>
          slot.weekday === localStart.weekday &&
          localEnd.weekday === localStart.weekday &&
          slot.startsAt <= localStart.time &&
          slot.endsAt >= localEnd.time,
        );
        if (!hasWorkingHours || doctor.exceptions.length > 0) {
          return { error: "The selected time is outside this doctor’s availability." as const, status: 409 };
        }

        const updated = await tx.appointment.updateMany({
          where: {
            id: appointment.id,
            clinicId: context.clinicId,
            doctorId: doctorProfileId,
            status: appointment.status,
            startsAt: appointment.startsAt,
            endsAt: appointment.endsAt,
          },
          data: { startsAt, endsAt },
        });
        if (updated.count !== 1) {
          return { error: "This appointment changed while you were editing it. Refresh and try again." as const, status: 409 };
        }
        const block = await tx.scheduleBlock.findUnique({
          where: { appointmentId: appointment.id },
          select: { id: true },
        });
        if (block) {
          await tx.scheduleBlock.update({
            where: { id: block.id },
            data: { startsAt, endsAt },
          });
        } else {
          await tx.scheduleBlock.create({
            data: {
              clinicId: context.clinicId,
              doctorId: doctorProfileId,
              appointmentId: appointment.id,
              startsAt,
              endsAt,
            },
          });
        }
        await tx.auditLog.create({
          data: {
            clinicId: context.clinicId,
            userId: context.userId,
            action: "APPOINTMENT_RESCHEDULED",
            entity: "Appointment",
            entityId: appointment.id,
            metadata: {
              previousStartsAt: appointment.startsAt.toISOString(),
              previousEndsAt: appointment.endsAt.toISOString(),
              startsAt: startsAt.toISOString(),
              endsAt: endsAt.toISOString(),
            },
          },
        });
        return {
          appointment: await tx.appointment.findUniqueOrThrow({
            where: { id: appointment.id },
            select: { id: true, startsAt: true, endsAt: true, status: true },
          }),
        };
      });
      if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
      return Response.json({ appointment: result.appointment });
    }

    const parsed = updateInput.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "Invalid appointment status." }, { status: 400 });
    }
    const nextStatus = parsed.data.status as AppointmentStatus;
    if (nextStatus === AppointmentStatus.COMPLETED) {
      return Response.json({ error: "Complete the visit from its consultation record so the clinical note and outcome are saved together." }, { status: 409 });
    }
    if (
      context.role === ClinicRole.DOCTOR &&
      nextStatus !== AppointmentStatus.IN_CONSULTATION
    ) {
      return Response.json({ error: "Doctors cannot check in or cancel appointments." }, { status: 403 });
    }
    if (
      context.role !== ClinicRole.DOCTOR &&
      nextStatus !== AppointmentStatus.ARRIVED &&
      nextStatus !== AppointmentStatus.CANCELLED
    ) {
      return Response.json({ error: "Only the assigned doctor can start or complete a visit." }, { status: 403 });
    }
    const result = await withClinic(context, async (tx) => {
      const appointment = await tx.appointment.findFirst({
        where: {
          id,
          clinicId: context.clinicId,
          ...(context.doctorProfileId ? { doctorId: context.doctorProfileId } : {}),
        },
        select: { id: true, status: true },
      });
      if (!appointment) return { error: "Appointment not found." as const, status: 404 };
      if (!allowedTransitions[appointment.status].includes(nextStatus)) {
        return { error: `Cannot change ${appointment.status} to ${nextStatus}.` as const, status: 409 };
      }
      const updated = await tx.appointment.update({
        where: { id: appointment.id },
        data: {
          status: nextStatus,
          ...(nextStatus === AppointmentStatus.ARRIVED ? { checkedInAt: new Date() } : {}),
          ...(nextStatus === AppointmentStatus.CANCELLED
            ? { cancelledAt: new Date(), cancelReason: parsed.data.cancelReason ?? null }
            : {}),
        },
        select: { id: true, status: true, checkedInAt: true, cancelledAt: true },
      });
      if (nextStatus === AppointmentStatus.CANCELLED) {
        await tx.scheduleBlock.deleteMany({ where: { appointmentId: appointment.id } });
      }
      await tx.auditLog.create({
        data: {
          clinicId: context.clinicId,
          userId: context.userId,
          action: `APPOINTMENT_${nextStatus}`,
          entity: "Appointment",
          entityId: appointment.id,
        },
      });
      return { appointment: updated };
    });
    if ("error" in result) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return Response.json({ appointment: result.appointment });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return Response.json({ error: "Appointment was changed by another user. Refresh and try again." }, { status: 409 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2004" || error.code === "P2034")) {
      return Response.json({ error: "That time is no longer available. Choose another slot." }, { status: 409 });
    }
    console.error("Appointment update failed", error);
    return Response.json({ error: "Unable to update appointment." }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireClinicUser([ClinicRole.DOCTOR]);
    if (!context.doctorProfileId) {
      return Response.json({ error: "A doctor profile is required." }, { status: 403 });
    }
    const doctorProfileId = context.doctorProfileId;
    const body = await request.json().catch(() => ({}));
    const parsed = cancelInput.safeParse(body);
    if (!parsed.success) return Response.json({ error: "Invalid cancellation reason." }, { status: 400 });
    const { id } = await params;

    const result = await withClinic(context, async (tx) => {
      const appointment = await tx.appointment.findFirst({
        where: {
          id,
          clinicId: context.clinicId,
          doctorId: doctorProfileId,
          status: { in: [AppointmentStatus.BOOKED, AppointmentStatus.ARRIVED] },
        },
        select: { id: true },
      });
      if (!appointment) {
        return { error: "Only a booked or checked-in appointment assigned to you can be cancelled." as const, status: 409 };
      }

      const cancelledAt = new Date();
      const updated = await tx.appointment.updateMany({
        where: {
          id: appointment.id,
          clinicId: context.clinicId,
          doctorId: doctorProfileId,
          status: { in: [AppointmentStatus.BOOKED, AppointmentStatus.ARRIVED] },
        },
        data: {
          status: AppointmentStatus.CANCELLED,
          cancelledAt,
          cancelReason: parsed.data.reason || "Cancelled by doctor",
        },
      });
      if (updated.count !== 1) {
        return { error: "This appointment changed while you were editing it. Refresh and try again." as const, status: 409 };
      }
      await tx.scheduleBlock.deleteMany({ where: { appointmentId: appointment.id } });
      await tx.followUp.updateMany({
        where: { bookedAppointmentId: appointment.id, status: FollowUpStatus.BOOKED },
        data: { status: FollowUpStatus.OPEN, bookedAppointmentId: null },
      });
      await tx.auditLog.create({
        data: {
          clinicId: context.clinicId,
          userId: context.userId,
          action: "APPOINTMENT_CANCELLED_BY_DOCTOR",
          entity: "Appointment",
          entityId: appointment.id,
        },
      });
      return {
        appointment: await tx.appointment.findUniqueOrThrow({
          where: { id: appointment.id },
          select: { id: true, status: true, cancelledAt: true },
        }),
      };
    });
    if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ appointment: result.appointment });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return Response.json({ error: "Appointment was changed by another user. Refresh and try again." }, { status: 409 });
    }
    console.error("Appointment cancellation failed", error);
    return Response.json({ error: "Unable to cancel appointment." }, { status: 500 });
  }
}
