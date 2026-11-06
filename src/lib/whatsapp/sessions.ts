import { localScheduleTime } from "../booking-time.mjs";

// Times of day patients choose between. Bands are by local start time; the hours shown
// to patients come from the doctors' real availability, not from these bounds.
export const SESSIONS = [
  { id: "morning", title: "Morning", icon: "🌅", from: 0, to: 13 * 60 },
  { id: "afternoon", title: "Afternoon", icon: "☀️", from: 13 * 60, to: 18 * 60 },
  { id: "evening", title: "Evening", icon: "🌙", from: 18 * 60, to: 24 * 60 },
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

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function dayRange(weekdays: number[]) {
  const days = [...new Set(weekdays)].sort((a, b) => a - b);
  if (days.length === 0) return "";
  const contiguous = days.every((day, index) => index === 0 || day === days[index - 1] + 1);
  if (contiguous && days.length > 2) return `${DAY_NAMES[days[0] - 1]}–${DAY_NAMES[days[days.length - 1] - 1]}`;
  return days.map((day) => DAY_NAMES[day - 1]).join(", ");
}

// Opening hours per session across the given availability windows, e.g. { morning: "9 AM – 1 PM" }.
export function sessionHours(windows: Window[]): Partial<Record<SessionId, string>> {
  const hours: Partial<Record<SessionId, string>> = {};
  for (const session of SESSIONS) {
    // Clip each window to the session, so one long window (e.g. 09:00–20:00) counts towards every session it covers.
    const parts = windows
      .map((window) => ({ start: Math.max(toMinutes(window.startsAt), session.from), end: Math.min(toMinutes(window.endsAt), session.to) }))
      .filter((part) => part.start < part.end);
    if (parts.length === 0) continue;
    const start = Math.min(...parts.map((part) => part.start));
    const end = Math.max(...parts.map((part) => part.end));
    hours[session.id] = `${clockLabel(toClock(start))} – ${clockLabel(toClock(end))}`;
  }
  return hours;
}

// Builds the weekly timings shown before the day list, e.g.
// "Weekly timings (Mon–Sat)\n🌅 Morning: 9 AM – 1 PM\n☀️ Afternoon: 2 PM – 5 PM\n🌙 Evening: 6 PM – 8 PM"
export function weeklyTimings(windows: Window[]): string {
  if (windows.length === 0) return "";
  const hours = sessionHours(windows);
  const lines = SESSIONS.filter((session) => hours[session.id]).map((session) => `${session.icon} ${session.title}: ${hours[session.id]}`);
  return `Weekly timings (${dayRange(windows.map((w) => w.weekday))})\n${lines.join("\n")}`;
}
