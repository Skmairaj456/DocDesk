import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clockLabel, sessionOfClock, sessionOfInstant, weeklyTimings } from "../src/lib/whatsapp/sessions.ts";

describe("WhatsApp booking sessions", () => {
  it("groups clock times into morning, afternoon and evening", () => {
    assert.equal(sessionOfClock("09:00"), "morning");
    assert.equal(sessionOfClock("12:30"), "morning");
    assert.equal(sessionOfClock("14:00"), "afternoon");
    assert.equal(sessionOfClock("16:30"), "afternoon");
    assert.equal(sessionOfClock("18:00"), "evening");
    assert.equal(sessionOfInstant(new Date("2026-11-09T12:30:00Z"), "Asia/Kolkata"), "evening"); // 6 PM IST
  });

  it("formats clock labels", () => {
    assert.equal(clockLabel("09:00"), "9 AM");
    assert.equal(clockLabel("13:30"), "1:30 PM");
    assert.equal(clockLabel("12:00"), "12 PM");
  });

  it("builds the weekly timings from availability windows", () => {
    const windows = [1, 2, 3, 4, 5, 6].flatMap((weekday) => [
      { weekday, startsAt: "09:00", endsAt: "13:00" },
      { weekday, startsAt: "14:00", endsAt: "17:00" },
      { weekday, startsAt: "18:00", endsAt: "20:00" },
    ]);
    assert.equal(
      weeklyTimings(windows),
      "Weekly timings (Mon–Sat)\n🌅 Morning: 9 AM – 1 PM\n☀️ Afternoon: 2 PM – 5 PM\n🌙 Evening: 6 PM – 8 PM",
    );
    assert.equal(weeklyTimings([]), "");
  });

  it("splits one long window across the sessions it covers", () => {
    assert.equal(
      weeklyTimings([{ weekday: 1, startsAt: "10:00", endsAt: "19:30" }]),
      "Weekly timings (Mon)\n🌅 Morning: 10 AM – 1 PM\n☀️ Afternoon: 1 PM – 6 PM\n🌙 Evening: 6 PM – 7:30 PM",
    );
  });
});
