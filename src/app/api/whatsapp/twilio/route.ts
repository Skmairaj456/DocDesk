import { MessageStatus, Prisma } from "@prisma/client";
import { after } from "next/server";
import { withWorker } from "@/lib/tenant-db";
import { digitsFromWhatsAppAddress, isValidTwilioSignature } from "@/lib/twilio";
import { ingestInbound, processConversation } from "@/lib/whatsapp/events";
import { dispatchOutbox } from "@/lib/whatsapp/outbox";

const maxBytes = 65_536;

const statusMap: Record<string, { status: MessageStatus; from: MessageStatus[] } | undefined> = {
  sent: { status: MessageStatus.SENT, from: [MessageStatus.QUEUED, MessageStatus.SENT] },
  delivered: { status: MessageStatus.DELIVERED, from: [MessageStatus.QUEUED, MessageStatus.SENT, MessageStatus.DELIVERED] },
  read: { status: MessageStatus.READ, from: [MessageStatus.QUEUED, MessageStatus.SENT, MessageStatus.DELIVERED, MessageStatus.READ] },
  failed: { status: MessageStatus.FAILED, from: [MessageStatus.QUEUED, MessageStatus.SENT, MessageStatus.FAILED] },
  undelivered: { status: MessageStatus.FAILED, from: [MessageStatus.QUEUED, MessageStatus.SENT, MessageStatus.FAILED] },
};

export async function POST(request: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const clinicId = process.env.WHATSAPP_CLINIC_ID;
  const webhookUrl = process.env.TWILIO_WEBHOOK_URL;
  const fromNumber = process.env.TWILIO_WHATSAPP_FROM;
  if (!authToken || !clinicId || !webhookUrl || !fromNumber) {
    return Response.json({ error: "Twilio webhook processing is not configured." }, { status: 503 });
  }
  const raw = await request.text();
  if (raw.length > maxBytes) return Response.json({ error: "Payload is too large." }, { status: 413 });
  const params = new URLSearchParams(raw);
  if (!isValidTwilioSignature(webhookUrl, params, request.headers.get("x-twilio-signature"), authToken)) {
    return Response.json({ error: "Invalid Twilio signature." }, { status: 401 });
  }

  const messageSid = params.get("MessageSid") ?? params.get("SmsMessageSid");
  if (!messageSid) return Response.json({ error: "Missing MessageSid." }, { status: 400 });

  // Delivery receipts for messages we sent.
  const deliveryStatus = params.get("MessageStatus");
  if (deliveryStatus && !params.has("Body")) {
    const mapped = statusMap[deliveryStatus];
    if (!mapped) return Response.json({ ok: true, ignored: true });
    try {
      await withWorker(async (tx) => {
        await tx.webhookEvent.create({
          data: { clinicId, externalEventKey: `twilio-status:${messageSid}:${deliveryStatus}`, eventType: `DELIVERY_${deliveryStatus.toUpperCase()}`, processedAt: new Date() },
        });
        await tx.whatsAppMessage.updateMany({
          where: { externalId: messageSid, status: { in: mapped.from } },
          data: { status: mapped.status, errorCode: params.get("ErrorCode") ?? null },
        });
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
        console.error("Unable to update Twilio delivery state", error);
        return Response.json({ error: "Unable to store delivery state; retry." }, { status: 500 });
      }
    }
    return Response.json({ ok: true });
  }

  const to = digitsFromWhatsAppAddress(params.get("To") ?? "");
  if (to !== digitsFromWhatsAppAddress(fromNumber)) {
    return Response.json({ error: "Message was not sent to this clinic's number." }, { status: 403 });
  }
  const phone = digitsFromWhatsAppAddress(params.get("From") ?? "");
  if (!phone) return Response.json({ error: "Invalid sender." }, { status: 400 });

  const numMedia = Number(params.get("NumMedia") ?? "0");
  const text = numMedia > 0 && !params.get("Body") ? "[unsupported message type]" : (params.get("Body") ?? "").trim().slice(0, 4096);

  try {
    const result = await ingestInbound({
      clinicId,
      phone,
      eventKey: `message:${messageSid}`,
      text,
      displayName: params.get("ProfileName")?.slice(0, 80),
      externalId: messageSid,
    });
    if (!result.duplicate && result.conversationId) {
      const conversationId = result.conversationId;
      after(async () => {
        await processConversation(conversationId).catch((error) => console.error("WhatsApp processing failed", error));
        await dispatchOutbox().catch((error) => console.error("WhatsApp dispatch failed", error));
      });
    }
  } catch (error) {
    console.error("Unable to store inbound Twilio message", error);
    return Response.json({ error: "Unable to store message; retry." }, { status: 500 });
  }

  // An empty TwiML response tells Twilio not to auto-reply; replies go through the outbox.
  return new Response("<Response></Response>", { status: 200, headers: { "Content-Type": "text/xml" } });
}
