import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizePhone, parseDateOfBirth, parseName } from "../src/lib/whatsapp/text.ts";

describe("WhatsApp text helpers", () => {
  const today = "2026-10-28";

  it("parses common date formats and rejects impossible dates", () => {
    assert.equal(parseDateOfBirth("25/03/1990", today), "1990-03-25");
    assert.equal(parseDateOfBirth("1990-03-25", today), "1990-03-25");
    assert.equal(parseDateOfBirth("31/02/1990", today), null);
    assert.equal(parseDateOfBirth("25/03/2999", today), null);
    assert.equal(parseDateOfBirth("not a date", today), null);
  });

  it("accepts real names and rejects junk", () => {
    assert.equal(parseName("  rahul   sharma "), "rahul sharma");
    assert.equal(parseName("12345"), null);
    assert.equal(parseName("a"), null);
  });

  it("normalizes phone numbers to digits", () => {
    assert.equal(normalizePhone("+91 98765-43210"), "919876543210");
  });
});
