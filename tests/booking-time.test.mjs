import test from "node:test";
import assert from "node:assert/strict";
import { localDateTimeAsUtc, localDayBounds, localMidnightAsUtc, localScheduleTime } from "../src/lib/booking-time.mjs";

test("converts clinic local midnight to UTC for India", () => {
  assert.equal(localMidnightAsUtc("2026-10-26", "Asia/Kolkata").toISOString(), "2026-10-25T18:30:00.000Z");
});

test("uses 23- and 25-hour clinic days across daylight-saving transitions", () => {
  const spring = localDayBounds("2026-03-08", "America/Los_Angeles");
  const autumn = localDayBounds("2026-11-01", "America/Los_Angeles");
  assert.equal((spring.end - spring.start) / 3_600_000, 23);
  assert.equal((autumn.end - autumn.start) / 3_600_000, 25);
});

test("converts an appointment instant to its clinic weekday and wall-clock time", () => {
  const local = localScheduleTime(new Date("2026-10-26T03:30:00.000Z"), "Asia/Kolkata");
  assert.deepEqual(local, { weekday: 1, time: "09:00" });
});

test("converts clinic wall-clock appointments into the correct UTC instant", () => {
  assert.equal(localDateTimeAsUtc("2026-10-26", "09:00", "Asia/Kolkata").toISOString(), "2026-10-26T03:30:00.000Z");
});

test("rejects a local appointment time skipped by daylight-saving changes", () => {
  assert.throws(
    () => localDateTimeAsUtc("2026-03-08", "02:30", "America/Los_Angeles"),
    RangeError,
  );
});

test("rejects invalid local dates", () => {
  assert.throws(() => localDayBounds("2026-02-30", "Asia/Kolkata"), RangeError);
});
