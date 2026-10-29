import { createHmac, timingSafeEqual } from "node:crypto";

export function twilioConfigured() {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM);
}

// Twilio signs the full webhook URL plus the POST fields sorted by name (HMAC-SHA1, base64).
export function isValidTwilioSignature(url: string, params: URLSearchParams, signature: string | null, authToken: string) {
  if (!signature) return false;
  const keys = [...new Set(params.keys())].sort();
  let data = url;
  for (const key of keys) for (const value of params.getAll(key)) data += key + value;
  const expected = createHmac("sha1", authToken).update(data).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function digitsFromWhatsAppAddress(address: string) {
  const digits = address.replace(/^whatsapp:/i, "").replace(/\D/g, "");
  return /^\d{8,16}$/.test(digits) ? digits : null;
}

export async function sendTwilioWhatsApp(toDigits: string, body: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const form = new URLSearchParams({
    From: `whatsapp:${process.env.TWILIO_WHATSAPP_FROM!.replace(/^whatsapp:/i, "")}`,
    To: `whatsapp:+${toDigits}`,
    Body: body.slice(0, 1600),
  });
  const callback = process.env.TWILIO_WEBHOOK_URL;
  if (callback) form.set("StatusCallback", callback);
  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) {
      const json = (await response.json()) as { sid?: string };
      return json.sid ? ({ ok: true, externalId: json.sid } as const) : ({ ok: false, retryable: true, code: "NO_MESSAGE_SID" } as const);
    }
    return { ok: false, retryable: response.status === 429 || response.status >= 500, code: `HTTP_${response.status}` } as const;
  } catch {
    return { ok: false, retryable: true, code: "NETWORK" } as const;
  }
}
