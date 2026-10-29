import { ConversationMode, MessageStatus, Prisma } from "@prisma/client";
import { withWorker } from "@/lib/tenant-db";
import { sendTwilioWhatsApp, twilioConfigured } from "@/lib/twilio";

export const MAX_SEND_ATTEMPTS = 5;
const LOCK_TIMEOUT_MS = 2 * 60_000;
const WINDOW_MS = 24 * 60 * 60_000;

type Option = { id: string; title: string; description?: string };
type Claimed = {
  id: string;
  body: string;
  attempts: number;
  isSimulated: boolean;
  phone: string;
  options: Option[] | null;
};

type SendResult = { ok: true; externalId: string } | { ok: false; retryable: boolean; code: string };

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function numberedBody(body: string, options: Option[] | null) {
  if (!options?.length) return body;
  return `${body}\n\n${options.map((option, index) => `${index + 1}. ${option.title}${option.description ? ` – ${option.description}` : ""}`).join("\n")}\n\nReply with a number.`;
}

function metaConfigured() {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

function realProviderConfigured() {
  return twilioConfigured() || metaConfigured();
}

async function sendReal(message: Claimed): Promise<SendResult> {
  // Twilio takes precedence when configured; it sends options as numbered text, which the engine already understands.
  if (twilioConfigured()) return sendTwilioWhatsApp(message.phone, numberedBody(message.body, message.options));
  const version = process.env.WHATSAPP_API_VERSION ?? "v21.0";
  const url = `https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const options = message.options ?? [];
  let message_: Record<string, unknown>;
  if (options.length > 0 && options.length <= 3) {
    message_ = {
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: clip(message.body, 1024) },
        action: { buttons: options.map((o) => ({ type: "reply", reply: { id: o.id.slice(0, 256), title: clip(o.title, 20) } })) },
      },
    };
  } else if (options.length > 3 && options.length <= 10) {
    message_ = {
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: clip(message.body, 1024) },
        action: {
          button: "Choose",
          sections: [{ title: "Options", rows: options.map((o) => ({ id: o.id.slice(0, 200), title: clip(o.title, 24), description: o.description ? clip(o.description, 72) : undefined })) }],
        },
      },
    };
  } else {
    message_ = { type: "text", text: { body: clip(numberedBody(message.body, message.options), 4096) } };
  }
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: message.phone, ...message_ }),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) {
      const json = (await response.json()) as { messages?: { id: string }[] };
      const id = json.messages?.[0]?.id;
      return id ? { ok: true, externalId: id } : { ok: false, retryable: true, code: "NO_MESSAGE_ID" };
    }
    return { ok: false, retryable: response.status === 429 || response.status >= 500, code: `HTTP_${response.status}` };
  } catch {
    return { ok: false, retryable: true, code: "NETWORK" };
  }
}

async function send(message: Claimed): Promise<SendResult> {
  if (message.isSimulated || !realProviderConfigured()) return { ok: true, externalId: `sim:${message.id}` };
  return sendReal(message);
}

async function claimNext(now: Date): Promise<Claimed | null> {
  return withWorker(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT m."id" FROM "WhatsAppMessage" m
      WHERE m."direction" = 'OUTBOUND' AND m."status" = 'QUEUED'
        AND (m."nextAttemptAt" IS NULL OR m."nextAttemptAt" <= ${now})
        AND (m."lockedAt" IS NULL OR m."lockedAt" < ${new Date(now.valueOf() - LOCK_TIMEOUT_MS)})
        AND NOT EXISTS (
          SELECT 1 FROM "WhatsAppMessage" e
          WHERE e."conversationId" = m."conversationId" AND e."direction" = 'OUTBOUND'
            AND e."status" = 'QUEUED' AND e."seq" < m."seq"
        )
      ORDER BY m."seq" ASC LIMIT 1
      FOR UPDATE OF m SKIP LOCKED`;
    if (rows.length === 0) return null;
    const message = await tx.whatsAppMessage.findUniqueOrThrow({
      where: { id: rows[0].id },
      include: { conversation: { select: { mode: true, phone: true, optedOutAt: true, lastInboundAt: true } } },
    });
    const { conversation } = message;
    let suppress: string | null = null;
    if (message.sender === "BOT" && conversation.mode === ConversationMode.HUMAN && message.kind !== "HANDOVER") suppress = "HANDOVER_SUPPRESSED";
    else if (conversation.optedOutAt && message.kind !== "OPT_OUT_ACK" && message.sender === "BOT") suppress = "OPTED_OUT";
    else if (
      !message.isSimulated && realProviderConfigured() &&
      (!conversation.lastInboundAt || now.valueOf() - conversation.lastInboundAt.valueOf() > WINDOW_MS)
    ) suppress = "WINDOW_CLOSED";
    if (suppress) {
      await tx.whatsAppMessage.update({ where: { id: message.id }, data: { status: MessageStatus.FAILED, errorCode: suppress, lockedAt: null } });
      return { id: "", body: "", attempts: 0, isSimulated: true, phone: "", options: null };
    }
    await tx.whatsAppMessage.update({ where: { id: message.id }, data: { lockedAt: now, attempts: { increment: 1 } } });
    return {
      id: message.id,
      body: message.body,
      attempts: message.attempts + 1,
      isSimulated: message.isSimulated,
      phone: conversation.phone,
      options: (message.interactive as Option[] | null) ?? null,
    };
  });
}

async function stillAllowed(id: string) {
  // Last check before the network call, so a staff takeover that just happened still wins.
  return withWorker(async (tx) => {
    const m = await tx.whatsAppMessage.findUnique({
      where: { id },
      select: { sender: true, kind: true, conversation: { select: { mode: true } } },
    });
    return !(m && m.sender === "BOT" && m.kind !== "HANDOVER" && m.conversation.mode === ConversationMode.HUMAN);
  });
}

async function finish(message: Claimed, result: SendResult) {
  await withWorker((tx) => {
    if (result.ok) {
      return tx.whatsAppMessage.update({
        where: { id: message.id },
        data: { status: MessageStatus.SENT, externalId: result.externalId, sentAt: new Date(), lockedAt: null, lastError: null, errorCode: null },
      });
    }
    const giveUp = !result.retryable || message.attempts >= MAX_SEND_ATTEMPTS;
    const data: Prisma.WhatsAppMessageUpdateInput = giveUp
      ? { status: MessageStatus.FAILED, errorCode: result.code, lastError: result.code, lockedAt: null }
      : { lastError: result.code, lockedAt: null, nextAttemptAt: new Date(Date.now() + Math.min(5 * 60_000, 2_000 * 2 ** message.attempts)) };
    return tx.whatsAppMessage.update({ where: { id: message.id }, data });
  });
}

// Sends queued messages in order per conversation. Failures never touch the data that caused the message.
export async function dispatchOutbox(limit = 25, now = new Date()): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < limit; i += 1) {
    const claimed = await claimNext(now);
    if (!claimed) break;
    if (!claimed.id) {
      failed += 1;
      continue;
    }
    if (!(await stillAllowed(claimed.id))) {
      await withWorker((tx) => tx.whatsAppMessage.update({ where: { id: claimed.id }, data: { status: MessageStatus.FAILED, errorCode: "HANDOVER_SUPPRESSED", lockedAt: null } }));
      failed += 1;
      continue;
    }
    const result = await send(claimed);
    await finish(claimed, result);
    if (result.ok) sent += 1;
    else failed += 1;
  }
  return { sent, failed };
}
