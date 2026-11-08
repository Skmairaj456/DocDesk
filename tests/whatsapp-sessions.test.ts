import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clockLabel, sessionHours, sessionOfClock, sessionOfInstant } from "../src/lib/whatsapp/sessions.ts";

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

  it("works out each session's hours from availability windows", () => {
    const windows = [
      { weekday: 1, startsAt: "09:00", endsAt: "13:00" },
      { weekday: 1, startsAt: "14:00", endsAt: "17:00" },
      { weekday: 1, startsAt: "18:00", endsAt: "20:00" },
    ];
    assert.deepEqual(sessionHours(windows), { morning: "9 AM – 1 PM", afternoon: "2 PM – 5 PM", evening: "6 PM – 8 PM" });
    assert.deepEqual(sessionHours([]), {});
  });

  it("splits one long window across the sessions it covers", () => {
    assert.deepEqual(sessionHours([{ weekday: 1, startsAt: "10:00", endsAt: "19:30" }]), {
      morning: "10 AM – 1 PM",
      afternoon: "1 PM – 6 PM",
      evening: "6 PM – 7:30 PM",
    });
  });
});
