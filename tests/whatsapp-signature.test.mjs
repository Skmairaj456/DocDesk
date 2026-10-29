import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { isValidWhatsAppSignature, safeEqualString } from "../src/lib/whatsapp-signature.mjs";

const body = Buffer.from('{"object":"whatsapp_business_account"}');
const secret = "development-only-test-secret";
const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

test("accepts the HMAC signature for an unchanged webhook body", () => {
  assert.equal(isValidWhatsAppSignature(body, signature, secret), true);
});

test("rejects a modified payload, malformed header, and missing secret", () => {
  assert.equal(isValidWhatsAppSignature(Buffer.from(`${body.toString()} `), signature, secret), false);
  assert.equal(isValidWhatsAppSignature(body, "sha256=bad", secret), false);
  assert.equal(isValidWhatsAppSignature(body, signature, ""), false);
});

test("compares verification tokens without accepting different lengths", () => {
  assert.equal(safeEqualString("clinic-token", "clinic-token"), true);
  assert.equal(safeEqualString("clinic-token", "clinic-token-extra"), false);
});
