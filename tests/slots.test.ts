import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeDaySlots, computeSlots, fitsAvailability, windowSpan } from "../src/lib/slots.ts";
import { sessionHours, sessionOfSlot } from "../src/lib/whatsapp/sessions.ts";

const timezone = "Asia/Kolkata";
// 2026-11-16 is a Monday; IST is UTC+5:30.
const ist = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);
const at = (date: string, time: string, minutes = 30) => [ist(date, time), new Date(ist(date, time).valueOf() + minutes * 60_000)] as const;

const lateEvening = [
  { weekday: 1, startsAt: "09:00", endsAt: "13:00" },
  { weekday: 1, startsAt: "18:00", endsAt: "01:00" }, // Monday 6 PM to Tuesday 1 AM
  { weekday: 6, startsAt: "18:00", endsAt: "01:00" }, // Saturday 6 PM to Sunday 1 AM
];

describe("Working windows past midnight", () => {
  it("reads an end before the start as the next morning", () => {
    assert.deepEqual(windowSpan({ startsAt: "18:00", endsAt: "01:00" }), { start: 1080, end: 1500 });
    assert.deepEqual(windowSpan({ startsAt: "18:00", endsAt: "23:00" }), { start: 1080, end: 1380 });
  });

  it("offers the after-midnight slots on the evening's own day, dated the next morning", () => {
    const doctor = { doctorId: "d", name: "Dr. Test", minutes: 30, availability: lateEvening };
    const slots = computeSlots({ timezone, date: "2026-11-16", doctor, busy: [], exceptions: [], now: new Date("2026-11-01T00:00:00Z") });
    const evening = slots.filter((slot) => slot.startsAt >= ist("2026-11-16", "18:00"));
    assert.equal(evening.length, 14, "6 PM to 1 AM in 30-minute visits");
    assert.deepEqual(evening.at(-1)!.startsAt, ist("2026-11-17", "00:30"));
    assert.deepEqual(evening.at(-1)!.endsAt, ist("2026-11-17", "01:00"));

    const tuesday = computeSlots({ timezone, date: "2026-11-17", doctor, busy: [], exceptions: [], now: new Date("2026-11-01T00:00:00Z") });
    assert.equal(tuesday.length, 0, "Monday night's slots are not offered again on Tuesday");
  });

  it("offers what is left of last night's session on today's list", () => {
    const doctor = { doctorId: "d", name: "Dr. Test", minutes: 30, availability: lateEvening };
    const now = ist("2026-11-17", "00:04"); // Tuesday 12:04 AM, Monday's evening still running
    const today = computeDaySlots({ timezone, date: "2026-11-17", doctor, busy: [], exceptions: [], now });
    assert.deepEqual(today.map((slot) => slot.startsAt), [ist("2026-11-17", "00:30")], "12:30 AM tonight; 12:00 is under the 15-minute lead");
    assert.equal(sessionOfSlot(today[0].startsAt, "2026-11-17", timezone), "evening");

    const later = computeDaySlots({ timezone, date: "2026-11-24", doctor, busy: [], exceptions: [], now });
    assert.equal(later.length, 0, "a future day's list does not repeat the night before it");
    const monday = computeDaySlots({ timezone, date: "2026-11-16", doctor, busy: [], exceptions: [], now: ist("2026-11-16", "20:00") });
    assert.equal(monday.at(-1)!.startsAt.valueOf(), ist("2026-11-17", "00:30").valueOf(), "Monday's own list still shows its late slots");
  });

  it("skips after-midnight slots that are already booked", () => {
    const doctor = { doctorId: "d", name: "Dr. Test", minutes: 30, availability: lateEvening };
    const [startsAt, endsAt] = at("2026-11-17", "00:00");
    const slots = computeSlots({ timezone, date: "2026-11-16", doctor, busy: [{ startsAt, endsAt }], exceptions: [], now: new Date("2026-11-01T00:00:00Z") });
    assert.ok(!slots.some((slot) => slot.startsAt.valueOf() === startsAt.valueOf()));
  });

  it("accepts visits inside the window, including after midnight, and rejects the rest", () => {
    assert.equal(fitsAvailability(lateEvening, ...at("2026-11-16", "22:30"), timezone), true);
    assert.equal(fitsAvailability(lateEvening, ...at("2026-11-16", "23:30"), timezone), true, "crosses midnight");
    assert.equal(fitsAvailability(lateEvening, ...at("2026-11-17", "00:30"), timezone), true, "Tuesday 12:30 AM is Monday night");
    assert.equal(fitsAvailability(lateEvening, ...at("2026-11-17", "01:00"), timezone), false, "ends after 1 AM");
    assert.equal(fitsAvailability(lateEvening, ...at("2026-11-16", "00:30"), timezone), false, "Monday 12:30 AM would be Sunday night");
    assert.equal(fitsAvailability(lateEvening, ...at("2026-11-22", "00:30"), timezone), true, "Sunday 12:30 AM is Saturday night");
    assert.equal(fitsAvailability(lateEvening, ...at("2026-11-16", "13:00"), timezone), false, "between sessions");
    assert.equal(fitsAvailability(lateEvening, ...at("2026-11-16", "09:00"), timezone), true);
  });

  it("keeps same-day windows working as before", () => {
    const windows = [{ weekday: 1, startsAt: "09:00", endsAt: "17:00" }];
    assert.equal(fitsAvailability(windows, ...at("2026-11-16", "16:30"), timezone), true);
    assert.equal(fitsAvailability(windows, ...at("2026-11-16", "16:45"), timezone), false);
  });
});

describe("Sessions past midnight", () => {
  it("shows a late window as one evening session ending at 1 AM", () => {
    assert.deepEqual(sessionHours(lateEvening.filter((window) => window.weekday === 1)), { morning: "9 AM – 1 PM", evening: "6 PM – 1 AM" });
  });

  it("keeps after-midnight slots in the evening of the list's day", () => {
    assert.equal(sessionOfSlot(ist("2026-11-17", "00:30"), "2026-11-16", timezone), "evening");
    assert.equal(sessionOfSlot(ist("2026-11-16", "09:30"), "2026-11-16", timezone), "morning");
    assert.equal(sessionOfSlot(ist("2026-11-16", "19:00"), "2026-11-16", timezone), "evening");
  });
});
