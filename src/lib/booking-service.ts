import { AppointmentSource, AppointmentStatus, FollowUpStatus, HoldStatus, Prisma, VisitType } from "@prisma/client";
import { localScheduleTime } from "@/lib/booking-time.mjs";
import { computeSlots, type DoctorSchedule, type Interval, type Slot } from "@/lib/slots";
import { addDays } from "@/lib/whatsapp/text";

export type Tx = Prisma.TransactionClient;
export const HOLD_MINUTES = 5;
export const BOOKING_HORIZON_DAYS = 14;

export type SchedulePool = {
  timezone: string;
  doctors: DoctorSchedule[];
  busy: Map<string, Interval[]>;
  exceptions: Map<string, Interval[]>;
};

export async function releaseExpiredHolds(tx: Tx, clinicId: string, doctorId?: string, now = new Date()) {
  const expired = await tx.appointmentHold.findMany({
    where: { clinicId, status: HoldStatus.ACTIVE, expiresAt: { lte: now }, ...(doctorId ? { doctorId } : {}) },
    select: { id: true },
    take: 200,
  });
  if (expired.length === 0) return 0;
  const ids = expired.map((hold) => hold.id);
  await tx.scheduleBlock.deleteMany({ where: { clinicId, holdId: { in: ids } } });
  await tx.appointmentHold.updateMany({
    where: { id: { in: ids }, status: HoldStatus.ACTIVE },
    data: { status: HoldStatus.EXPIRED },
  });
  return ids.length;
}

export async function listDepartmentsWithDoctors(tx: Tx, clinicId: string) {
  const departments = await tx.department.findMany({
    where: { clinicId, isActive: true, doctors: { some: { doctor: { membership: { isActive: true } } } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return departments;
}

export async function listDoctors(tx: Tx, clinicId: string, departmentId: string) {
  const doctors = await tx.doctorProfile.findMany({
    where: { clinicId, membership: { isActive: true }, departments: { some: { departmentId } } },
    select: { id: true, membership: { select: { user: { select: { displayName: true } } } } },
  });
  return doctors
    .map((doctor) => ({ id: doctor.id, name: doctor.membership.user.displayName }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Loads availability, exceptions and busy blocks for every doctor in a single round of queries.
export async function loadSchedulePool(
  tx: Tx,
  input: { clinicId: string; departmentId: string; doctorId?: string; fromDate: string; days: number; now?: Date },
): Promise<SchedulePool> {
  const now = input.now ?? new Date();
  const clinic = await tx.clinic.findUniqueOrThrow({ where: { id: input.clinicId }, select: { timezone: true } });
  const doctors = await tx.doctorProfile.findMany({
    where: {
      clinicId: input.clinicId,
      membership: { isActive: true },
      departments: { some: { departmentId: input.departmentId } },
      ...(input.doctorId ? { id: input.doctorId } : {}),
    },
    select: {
      id: true,
      consultationMinutes: true,
      membership: { select: { user: { select: { displayName: true } } } },
      availability: { where: { isAvailable: true }, select: { weekday: true, startsAt: true, endsAt: true } },
    },
  });
  const doctorIds = doctors.map((doctor) => doctor.id);
  const rangeStart = new Date(`${addDays(input.fromDate, -1)}T00:00:00Z`);
  const rangeEnd = new Date(`${addDays(input.fromDate, input.days + 1)}T00:00:00Z`);

  const [blocks, exceptions] = await Promise.all([
    tx.scheduleBlock.findMany({
      where: {
        clinicId: input.clinicId,
        doctorId: { in: doctorIds },
        startsAt: { lt: rangeEnd },
        endsAt: { gt: rangeStart },
        OR: [{ appointmentId: { not: null } }, { hold: { status: HoldStatus.ACTIVE, expiresAt: { gt: now } } }],
      },
      select: { doctorId: true, startsAt: true, endsAt: true },
    }),
    tx.availabilityException.findMany({
      where: { doctorId: { in: doctorIds }, isAvailable: false, startsAt: { lt: rangeEnd }, endsAt: { gt: rangeStart } },
      select: { doctorId: true, startsAt: true, endsAt: true },
    }),
  ]);

  const group = (rows: { doctorId: string; startsAt: Date; endsAt: Date }[]) => {
    const map = new Map<string, Interval[]>();
    for (const row of rows) map.set(row.doctorId, [...(map.get(row.doctorId) ?? []), { startsAt: row.startsAt, endsAt: row.endsAt }]);
    return map;
  };
  return {
    timezone: clinic.timezone,
    doctors: doctors.map((doctor) => ({
      doctorId: doctor.id,
      name: doctor.membership.user.displayName,
      minutes: doctor.consultationMinutes,
      availability: doctor.availability,
    })),
    busy: group(blocks),
    exceptions: group(exceptions),
  };
}

export function slotsForDate(pool: SchedulePool, date: string, now = new Date()): Slot[] {
  const all = pool.doctors.flatMap((doctor) =>
    computeSlots({
      timezone: pool.timezone,
      date,
      doctor,
      busy: pool.busy.get(doctor.doctorId) ?? [],
      exceptions: pool.exceptions.get(doctor.doctorId) ?? [],
      now,
    }),
  );
  // When several doctors are free at the same time, offer the time once.
  const byTime = new Map<number, Slot>();
  for (const slot of all.sort((a, b) => a.startsAt.valueOf() - b.startsAt.valueOf() || a.doctorName.localeCompare(b.doctorName))) {
    if (!byTime.has(slot.startsAt.valueOf())) byTime.set(slot.startsAt.valueOf(), slot);
  }
  return [...byTime.values()];
}

export type HoldResult =
  | { ok: true; holdId: string; expiresAt: Date }
  | { ok: false; reason: "SLOT_TAKEN" | "INVALID_SLOT" };

export async function createHold(
  tx: Tx,
  input: { clinicId: string; patientId: string; doctorId: string; departmentId: string; startsAt: Date; endsAt: Date; now?: Date },
): Promise<HoldResult> {
  const now = input.now ?? new Date();
  await releaseExpiredHolds(tx, input.clinicId, input.doctorId, now);

  const [clinic, doctor] = await Promise.all([
    tx.clinic.findUnique({ where: { id: input.clinicId }, select: { timezone: true } }),
    tx.doctorProfile.findFirst({
      where: {
        id: input.doctorId,
        clinicId: input.clinicId,
        membership: { isActive: true },
        departments: { some: { departmentId: input.departmentId } },
      },
      select: {
        consultationMinutes: true,
        availability: { where: { isAvailable: true }, select: { weekday: true, startsAt: true, endsAt: true } },
        exceptions: {
          where: { isAvailable: false, startsAt: { lt: input.endsAt }, endsAt: { gt: input.startsAt } },
          select: { id: true },
        },
      },
    }),
  ]);
  if (!clinic || !doctor || input.startsAt <= now) return { ok: false, reason: "INVALID_SLOT" };
  if (Math.round((input.endsAt.valueOf() - input.startsAt.valueOf()) / 60_000) !== doctor.consultationMinutes) {
    return { ok: false, reason: "INVALID_SLOT" };
  }
  const localStart = localScheduleTime(input.startsAt, clinic.timezone);
  const localEnd = localScheduleTime(input.endsAt, clinic.timezone);
  const insideWorkingHours = doctor.availability.some(
    (window) =>
      window.weekday === localStart.weekday &&
      localEnd.weekday === localStart.weekday &&
      window.startsAt <= localStart.time &&
      window.endsAt >= localEnd.time,
  );
  if (!insideWorkingHours || doctor.exceptions.length > 0) return { ok: false, reason: "INVALID_SLOT" };

  const expiresAt = new Date(now.valueOf() + HOLD_MINUTES * 60_000);
  const hold = await tx.appointmentHold.create({
    data: {
      clinicId: input.clinicId,
      patientId: input.patientId,
      doctorId: input.doctorId,
      departmentId: input.departmentId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      expiresAt,
    },
    select: { id: true },
  });
  // ON CONFLICT DO NOTHING keeps the transaction usable when the no-overlap constraint rejects the block.
  const inserted = await tx.$executeRaw`
    INSERT INTO "ScheduleBlock" ("id", "clinicId", "doctorId", "startsAt", "endsAt", "holdId")
    VALUES (gen_random_uuid(), ${input.clinicId}::uuid, ${input.doctorId}::uuid, ${input.startsAt}::timestamptz, ${input.endsAt}::timestamptz, ${hold.id}::uuid)
    ON CONFLICT DO NOTHING`;
  if (inserted === 0) {
    await tx.appointmentHold.delete({ where: { id: hold.id } });
    return { ok: false, reason: "SLOT_TAKEN" };
  }
  return { ok: true, holdId: hold.id, expiresAt };
}

export async function releaseHold(tx: Tx, clinicId: string, holdId: string) {
  const released = await tx.appointmentHold.updateMany({
    where: { id: holdId, clinicId, status: HoldStatus.ACTIVE },
    data: { status: HoldStatus.RELEASED },
  });
  if (released.count > 0) await tx.scheduleBlock.deleteMany({ where: { clinicId, holdId } });
  return released.count > 0;
}

export type ConfirmResult =
  | { ok: true; appointment: { id: string; reference: string; startsAt: Date; endsAt: Date; doctorId: string; departmentId: string }; reused: boolean }
  | { ok: false; reason: "EXPIRED" | "NOT_FOUND" | "SLOT_TAKEN" };

export async function confirmHold(
  tx: Tx,
  input: { clinicId: string; patientId: string; holdId: string; source: AppointmentSource; actorUserId?: string; now?: Date },
): Promise<ConfirmResult> {
  const now = input.now ?? new Date();
  const hold = await tx.appointmentHold.findFirst({
    where: { id: input.holdId, clinicId: input.clinicId, patientId: input.patientId },
    select: { id: true, status: true, doctorId: true, departmentId: true, startsAt: true, endsAt: true, expiresAt: true, appointmentId: true },
  });
  if (!hold) return { ok: false, reason: "NOT_FOUND" };

  if (hold.status === HoldStatus.CONFIRMED && hold.appointmentId) {
    const existing = await tx.appointment.findUnique({
      where: { id: hold.appointmentId },
      select: { id: true, reference: true, startsAt: true, endsAt: true, doctorId: true, departmentId: true },
    });
    if (existing) return { ok: true, appointment: existing, reused: true };
  }
  if (hold.status !== HoldStatus.ACTIVE || hold.expiresAt <= now) {
    await releaseExpiredHolds(tx, input.clinicId, hold.doctorId, now);
    return { ok: false, reason: "EXPIRED" };
  }

  const claimed = await tx.appointmentHold.updateMany({
    where: { id: hold.id, status: HoldStatus.ACTIVE, expiresAt: { gt: now } },
    data: { status: HoldStatus.CONFIRMED },
  });
  if (claimed.count !== 1) return { ok: false, reason: "EXPIRED" };

  let block = await tx.scheduleBlock.findFirst({ where: { clinicId: input.clinicId, holdId: hold.id }, select: { id: true } });
  if (!block) {
    // The expiry worker removed the block before we claimed the hold; take the slot again if it is still free.
    const reinserted = await tx.$executeRaw`
      INSERT INTO "ScheduleBlock" ("id", "clinicId", "doctorId", "startsAt", "endsAt", "holdId")
      VALUES (gen_random_uuid(), ${input.clinicId}::uuid, ${hold.doctorId}::uuid, ${hold.startsAt}::timestamptz, ${hold.endsAt}::timestamptz, ${hold.id}::uuid)
      ON CONFLICT DO NOTHING`;
    if (reinserted === 0) {
      await tx.appointmentHold.update({ where: { id: hold.id }, data: { status: HoldStatus.EXPIRED } });
      return { ok: false, reason: "SLOT_TAKEN" };
    }
    block = await tx.scheduleBlock.findFirst({ where: { clinicId: input.clinicId, holdId: hold.id }, select: { id: true } });
  }

  const appointment = await tx.appointment.create({
    data: {
      clinicId: input.clinicId,
      reference: `DD-${crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`,
      patientId: input.patientId,
      departmentId: hold.departmentId,
      doctorId: hold.doctorId,
      startsAt: hold.startsAt,
      endsAt: hold.endsAt,
      visitType: VisitType.CONSULTATION,
      source: input.source,
    },
    select: { id: true, reference: true, startsAt: true, endsAt: true, doctorId: true, departmentId: true },
  });
  await tx.scheduleBlock.update({ where: { id: block!.id }, data: { appointmentId: appointment.id, holdId: null } });
  await tx.appointmentHold.update({ where: { id: hold.id }, data: { appointmentId: appointment.id } });
  await tx.auditLog.create({
    data: {
      clinicId: input.clinicId,
      userId: input.actorUserId ?? null,
      action: "APPOINTMENT_BOOKED",
      entity: "Appointment",
      entityId: appointment.id,
      metadata: { source: input.source },
    },
  });
  return { ok: true, appointment, reused: false };
}

export type CancelResult = { ok: true } | { ok: false; reason: "NOT_FOUND" | "NOT_CANCELLABLE" };

export async function cancelAppointment(
  tx: Tx,
  input: { clinicId: string; appointmentId: string; patientId?: string; reason: string; actorUserId?: string; actorLabel: string },
): Promise<CancelResult> {
  const found = await tx.appointment.findFirst({
    where: { id: input.appointmentId, clinicId: input.clinicId, ...(input.patientId ? { patientId: input.patientId } : {}) },
    select: { id: true, status: true },
  });
  if (!found) return { ok: false, reason: "NOT_FOUND" };
  const updated = await tx.appointment.updateMany({
    where: { id: found.id, clinicId: input.clinicId, status: AppointmentStatus.BOOKED },
    data: { status: AppointmentStatus.CANCELLED, cancelledAt: new Date(), cancelReason: input.reason },
  });
  if (updated.count !== 1) return { ok: false, reason: "NOT_CANCELLABLE" };
  await tx.scheduleBlock.deleteMany({ where: { appointmentId: found.id } });
  await tx.followUp.updateMany({
    where: { bookedAppointmentId: found.id, status: FollowUpStatus.BOOKED },
    data: { status: FollowUpStatus.OPEN, bookedAppointmentId: null },
  });
  await tx.auditLog.create({
    data: {
      clinicId: input.clinicId,
      userId: input.actorUserId ?? null,
      action: "APPOINTMENT_CANCELLED",
      entity: "Appointment",
      entityId: found.id,
      metadata: { by: input.actorLabel },
    },
  });
  return { ok: true };
}
