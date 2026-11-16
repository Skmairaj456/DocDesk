import { clinicLocalDate, localScheduleTime } from "../booking-time.mjs";

// Times of day patients choose between. Bands are by local start time; the hours shown
// to patients come from the doctors' real availability, not from these bounds.
// The evening runs on past midnight (to 6 AM next day) so a late window such as 18:00–01:00
// is shown as one evening session.
export const SESSIONS = [
  { id: "morning", title: "Morning", icon: "🌅", from: 0, to: 13 * 60 },
  { id: "afternoon", title: "Afternoon", icon: "☀️", from: 13 * 60, to: 18 * 60 },
  { id: "evening", title: "Evening", icon: "🌙", from: 18 * 60, to: 30 * 60 },
] as const;

export type SessionId = (typeof SESSIONS)[number]["id"];
type Window = { weekday: number; startsAt: string; endsAt: string };

function toMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function toClock(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function sessionOfClock(time: string): SessionId {
  const minutes = toMinutes(time);
  return (SESSIONS.find((session) => minutes >= session.from && minutes < session.to) ?? SESSIONS[0]).id;
}

export function sessionOfInstant(date: Date, timeZone: string): SessionId {
  return sessionOfClock(localScheduleTime(date, timeZone).time);
}

// The session a slot is offered in on a given day's list. Slots after midnight come from an
// evening window running past midnight, so they stay in the evening: on the evening's own list
// (dated the next day) and on today's list while last night's session is still running.
const EARLY_HOURS_END = 6 * 60;
export function sessionOfSlot(startsAt: Date, listDate: string, timeZone: string): SessionId {
  if (clinicLocalDate(startsAt, timeZone) !== listDate) return "evening";
  const local = localScheduleTime(startsAt, timeZone).time;
  return toMinutes(local) < EARLY_HOURS_END ? "evening" : sessionOfClock(local);
}

export function isSessionId(value: string | undefined): value is SessionId {
  return SESSIONS.some((session) => session.id === value);
}

export function sessionTitle(id: SessionId) {
  return SESSIONS.find((session) => session.id === id)!.title;
}

// "09:00" -> "9 AM", "13:30" -> "1:30 PM"
export function clockLabel(time: string) {
  const minutes = toMinutes(time);
  const hours = Math.floor(minutes / 60) % 24;
  const rest = minutes % 60;
  const suffix = hours < 12 ? "AM" : "PM";
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelve}${rest ? `:${String(rest).padStart(2, "0")}` : ""} ${suffix}`;
}

// Opening hours per session across the given availability windows, e.g. { morning: "9 AM – 1 PM" }.
export function sessionHours(windows: Window[]): Partial<Record<SessionId, string>> {
  const hours: Partial<Record<SessionId, string>> = {};
  for (const session of SESSIONS) {
    // Clip each window to the session, so one long window (e.g. 09:00–20:00) counts towards every session it covers.
    const parts = windows
      .map((window) => {
        const start = toMinutes(window.startsAt);
        const end = toMinutes(window.endsAt);
        // An end not after the start means the window runs past midnight (18:00–01:00).
        return { start: Math.max(start, session.from), end: Math.min(end <= start ? end + 24 * 60 : end, session.to) };
      })
      .filter((part) => part.start < part.end);
    if (parts.length === 0) continue;
    const start = Math.min(...parts.map((part) => part.start));
    const end = Math.max(...parts.map((part) => part.end));
    hours[session.id] = `${clockLabel(toClock(start))} – ${clockLabel(toClock(end))}`;
  }
  return hours;
}
