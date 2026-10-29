import { createHmac, timingSafeEqual } from "node:crypto";

export function safeEqualString(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isValidWhatsAppSignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret || !signatureHeader) return false;
  const match = /^sha256=([a-f0-9]{64})$/i.exec(signatureHeader);
  if (!match) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const supplied = Buffer.from(match[1], "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
