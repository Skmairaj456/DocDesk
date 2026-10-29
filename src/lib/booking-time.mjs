export function localScheduleTime(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(values.weekday) + 1;
  return { weekday, time: `${values.hour}:${values.minute}` };
}

export function clinicLocalDate(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function localMidnightAsUtc(date, timeZone) {
  return localDateTimeAsUtc(date, "00:00", timeZone);
}

export function localDateTimeAsUtc(date, time, timeZone) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let instant = target;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(instant)).map(({ type, value }) => [type, value]),
    );
    const represented = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    );
    const difference = target - represented;
    instant += difference;
    if (difference === 0) break;
  }
  const converted = new Date(instant);
  const convertedLocal = localScheduleTime(converted, timeZone);
  const convertedParts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(converted);
  const values = Object.fromEntries(convertedParts.map(({ type, value }) => [type, value]));
  if (
    Number(values.year) !== year ||
    Number(values.month) !== month ||
    Number(values.day) !== day ||
    convertedLocal.time !== time
  ) {
    throw new RangeError("That local time does not exist in the clinic timezone.");
  }
  return converted;
}

export function localDayBounds(date, timeZone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new RangeError("Use a valid YYYY-MM-DD date.");
  }
  const nextDate = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(nextDate.valueOf()) || nextDate.toISOString().slice(0, 10) !== date) {
    throw new RangeError("Use a valid YYYY-MM-DD date.");
  }
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  return {
    start: localMidnightAsUtc(date, timeZone),
    end: localMidnightAsUtc(nextDate.toISOString().slice(0, 10), timeZone),
  };
}
