const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

export function parseName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) return null;
  if (!/^[\p{L}][\p{L}\p{M} .'-]*$/u.test(name)) return null;
  return name;
}

function validDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Accepts DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, YYYY-MM-DD and "5 Mar 1990". Returns an ISO date or null.
export function parseDateOfBirth(raw: string, today: string): string | null {
  const text = raw.trim().toLowerCase();
  let iso: string | null = null;
  let match = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (match) iso = validDate(Number(match[3]), Number(match[2]), Number(match[1]));
  match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!iso && match) iso = validDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = text.match(/^(\d{1,2})\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4})$/);
  if (!iso && match) {
    const month = monthNames.indexOf(match[2]) + 1;
    if (month > 0) iso = validDate(Number(match[3]), month, Number(match[1]));
  }
  if (!iso) return null;
  if (iso > today) return null;
  if (Number(today.slice(0, 4)) - Number(iso.slice(0, 4)) > 120) return null;
  return iso;
}

export function formatDobForDisplay(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function formatClinicTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).format(date).toUpperCase();
}

export function formatClinicDate(date: Date | string, timeZone: string): string {
  const value = typeof date === "string" ? new Date(`${date}T12:00:00Z`) : date;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: typeof date === "string" ? "UTC" : timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(value);
}

export function firstName(fullName: string): string {
  return fullName.split(" ")[0] ?? fullName;
}
