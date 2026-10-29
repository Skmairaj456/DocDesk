import assert from "node:assert/strict";
import test from "node:test";
import { digitsFromWhatsAppAddress, isValidTwilioSignature } from "../src/lib/twilio.ts";

const url = "https://x.test/api/whatsapp/twilio";
const params = new URLSearchParams({ From: "whatsapp:+919000000001", Body: "hi", MessageSid: "SM1" });

test("accepts a correct Twilio signature and rejects tampering", () => {
  const signature = "YfRJ+s32hNqax4f+C8v8UMd8PxQ=";
  assert.equal(isValidTwilioSignature(url, params, signature, "tok"), true);
  assert.equal(isValidTwilioSignature(url, params, signature, "other"), false);
  assert.equal(isValidTwilioSignature(url, new URLSearchParams({ ...Object.fromEntries(params), Body: "bye" }), signature, "tok"), false);
  assert.equal(isValidTwilioSignature(url, params, null, "tok"), false);
});

test("extracts digits from WhatsApp addresses", () => {
  assert.equal(digitsFromWhatsAppAddress("whatsapp:+919000000001"), "919000000001");
  assert.equal(digitsFromWhatsAppAddress("junk"), null);
});
