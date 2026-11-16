import { localDateTimeAsUtc, localScheduleTime } from "./booking-time.mjs";

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

function nextDate(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

const DAY_MINUTES = 24 * 60;

// A window whose end is not after its start runs past midnight: 18:00–01:00 is 6 PM to 1 AM the
// next morning. The span is in minutes from the start of the window's own weekday, so its end
// can go beyond 24:00.
export function windowSpan(window: { startsAt: string; endsAt: string }): { start: number; end: number } {
  const start = toMinutes(window.startsAt);
  const end = toMinutes(window.endsAt);
  return { start, end: end <= start ? end + DAY_MINUTES : end };
}

// Whether a visit lies wholly inside one of the doctor's working windows, including the part of
// an evening window that continues after midnight into the next day.
export function fitsAvailability(windows: AvailabilityWindow[], startsAt: Date, endsAt: Date, timezone: string): boolean {
  const local = localScheduleTime(startsAt, timezone);
  const start = toMinutes(local.time);
  const duration = Math.round((endsAt.valueOf() - startsAt.valueOf()) / 60_000);
  const previousWeekday = local.weekday === 1 ? 7 : local.weekday - 1;
  return windows.some((window) => {
    const span = windowSpan(window);
    const offset = window.weekday === local.weekday ? 0 : window.weekday === previousWeekday ? DAY_MINUTES : null;
    if (offset === null) return false;
    return start + offset >= span.start && start + offset + duration <= span.end;
  });
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
    const span = windowSpan(window);
    for (let start = span.start; start + input.doctor.minutes <= span.end; start += input.doctor.minutes) {
      let startsAt: Date;
      let endsAt: Date;
      try {
        // Times after midnight belong to this evening's window but fall on the next calendar day.
        startsAt = start >= DAY_MINUTES
          ? localDateTimeAsUtc(nextDate(input.date), toClock(start - DAY_MINUTES), input.timezone)
          : localDateTimeAsUtc(input.date, toClock(start), input.timezone);
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
