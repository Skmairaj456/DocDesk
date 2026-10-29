import { localDateTimeAsUtc } from "./booking-time.mjs";

export type AvailabilityWindow = { weekday: number; startsAt: string; endsAt: string };
export type Interval = { startsAt: Date; endsAt: Date };
export type DoctorSchedule = {
  doctorId: string;
  name: string;
  minutes: number;
  availability: AvailabilityWindow[];
};
export type Slot = { doctorId: string; doctorName: string; startsAt: Date; endsAt: Date };

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function toClock(totalMinutes: number): string {
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const minutes = String(totalMinutes % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

// Monday = 1 ... Sunday = 7, matching localScheduleTime.
export function weekdayOf(date: string): number {
  return ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
}

function overlaps(a: Interval, b: Interval): boolean {
  return a.startsAt < b.endsAt && a.endsAt > b.startsAt;
}

export function computeSlots(input: {
  timezone: string;
  date: string;
  doctor: DoctorSchedule;
  busy: Interval[];
  exceptions: Interval[];
  now: Date;
  leadMinutes?: number;
}): Slot[] {
  const earliest = input.now.valueOf() + (input.leadMinutes ?? 15) * 60_000;
  const weekday = weekdayOf(input.date);
  const slots: Slot[] = [];

  for (const window of input.doctor.availability) {
    if (window.weekday !== weekday) continue;
    const windowEnd = toMinutes(window.endsAt);
    for (let start = toMinutes(window.startsAt); start + input.doctor.minutes <= windowEnd; start += input.doctor.minutes) {
      let startsAt: Date;
      let endsAt: Date;
      try {
        startsAt = localDateTimeAsUtc(input.date, toClock(start), input.timezone);
        endsAt = new Date(startsAt.valueOf() + input.doctor.minutes * 60_000);
      } catch {
        continue; // Local time skipped by a daylight-saving change.
      }
      if (startsAt.valueOf() < earliest) continue;
      const candidate = { startsAt, endsAt };
      if (input.busy.some((block) => overlaps(candidate, block))) continue;
      if (input.exceptions.some((block) => overlaps(candidate, block))) continue;
      slots.push({ doctorId: input.doctor.doctorId, doctorName: input.doctor.name, startsAt, endsAt });
    }
  }
  return slots.sort((a, b) => a.startsAt.valueOf() - b.startsAt.valueOf());
}
