import { MessageStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { isValidWhatsAppSignature, safeEqualString } from "@/lib/whatsapp-signature.mjs";
import { after } from "next/server";
import { withWorker } from "@/lib/tenant-db";
import { ingestInbound, processConversation } from "@/lib/whatsapp/events";
import { dispatchOutbox } from "@/lib/whatsapp/outbox";

const webhookSchema = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(z.object({
    changes: z.array(z.object({
      value: z.object({
        metadata: z.object({ phone_number_id: z.string() }),
        contacts: z.array(z.object({ wa_id: z.string(), profile: z.object({ name: z.string() }).optional() })).optional(),
        messages: z.array(z.object({
          id: z.string().min(1),
          from: z.string().regex(/^\d{8,16}$/),
          type: z.string(),
          timestamp: z.string().optional(),
          text: z.object({ body: z.string().max(4096) }).optional(),
          interactive: z.object({
            button_reply: z.object({ id: z.string(), title: z.string() }).optional(),
            list_reply: z.object({ id: z.string(), title: z.string() }).optional(),
          }).optional(),
        })).optional(),
        statuses: z.array(z.object({
          id: z.string().min(1),
          status: z.enum(["sent", "delivered", "read", "failed"]),
          errors: z.array(z.object({ code: z.union([z.string(), z.number()]).optional() })).optional(),
        })).optional(),
      }),
    })),
  })),
});

const maxWebhookBytes = 1_048_576;

async function readBoundedBody(request: Request): Promise<Buffer | null> {
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let length = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxWebhookBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, length);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!expectedToken || !token || !challenge) {
    return Response.json({ error: "WhatsApp webhook verification is not configured." }, { status: 503 });
  }
  if (mode !== "subscribe" || !safeEqualString(token, expectedToken)) {
    return Response.json({ error: "Webhook verification failed." }, { status: 403 });
  }
  return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

export async function POST(request: Request) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  const clinicId = process.env.WHATSAPP_CLINIC_ID;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!appSecret || !clinicId || !phoneNumberId) {
    return Response.json({ error: "WhatsApp webhook processing is not configured." }, { status: 503 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > maxWebhookBytes) {
    return Response.json({ error: "Webhook payload is too large." }, { status: 413 });
  }
  const rawBody = await readBoundedBody(request);
  if (!rawBody) return Response.json({ error: "Webhook payload is too large." }, { status: 413 });
  const signature = request.headers.get("x-hub-signature-256");
  if (!isValidWhatsAppSignature(rawBody, signature, appSecret)) {
    return Response.json({ error: "Invalid WhatsApp webhook signature." }, { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return Response.json({ error: "Webhook body must be valid JSON." }, { status: 400 });
  }
  const parsed = webhookSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Unsupported WhatsApp webhook payload." }, { status: 400 });
  }
  if (parsed.data.entry.some((entry) => entry.changes.some((change) => change.value.metadata.phone_number_id !== phoneNumberId))) {
    return Response.json({ error: "Webhook phone number does not match this clinic." }, { status: 403 });
  }

  const conversationIds = new Set<string>();
  let processed = 0;
  let duplicates = 0;
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      const { messages = [], statuses = [] } = change.value;
      const profiles = new Map((change.value.contacts ?? []).map((contact) => [contact.wa_id, contact.profile?.name]));
      for (const message of messages) {
        let text = "";
        let optionId: string | undefined;
        if (message.type === "text") text = message.text?.body?.trim() ?? "";
        else if (message.type === "interactive") {
          const reply = message.interactive?.button_reply ?? message.interactive?.list_reply;
          optionId = reply?.id;
          text = reply?.title ?? "";
        } else text = "[unsupported message type]";
        try {
          const result = await ingestInbound({
            clinicId,
            phone: message.from,
            eventKey: `message:${message.id}`,
            text,
            optionId,
            displayName: profiles.get(message.from)?.slice(0, 80),
            externalId: message.id,
          });
          if (result.duplicate) {
            duplicates += 1;
            continue;
          }
          processed += 1;
          if (result.conversationId) conversationIds.add(result.conversationId);
        } catch (error) {
          console.error("Unable to store inbound WhatsApp message", error);
          return Response.json({ error: "Unable to store webhook event; retry the delivery." }, { status: 500 });
        }
      }      for (const status of statuses) {
        const key = `status:${status.id}:${status.status}`;
        const mappedStatus = {
          sent: MessageStatus.SENT,
          delivered: MessageStatus.DELIVERED,
          read: MessageStatus.READ,
          failed: MessageStatus.FAILED,
        }[status.status];
        const previousStatuses = {
          sent: [MessageStatus.QUEUED, MessageStatus.SENT],
          delivered: [MessageStatus.QUEUED, MessageStatus.SENT, MessageStatus.DELIVERED],
          read: [MessageStatus.QUEUED, MessageStatus.SENT, MessageStatus.DELIVERED, MessageStatus.READ],
          failed: [MessageStatus.QUEUED, MessageStatus.SENT, MessageStatus.FAILED],
        }[status.status];
        try {
          await withWorker(async (tx) => {
            await tx.webhookEvent.create({
              data: { clinicId, externalEventKey: key, eventType: `DELIVERY_${status.status.toUpperCase()}`, processedAt: new Date() },
            });
            await tx.whatsAppMessage.updateMany({
              where: { externalId: status.id, status: { in: previousStatuses } },
              data: {
                status: mappedStatus,
                errorCode: status.errors?.[0]?.code?.toString() ?? null,
              },
            });
          });
          processed += 1;
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            duplicates += 1;
            continue;
          }
          console.error("Unable to update WhatsApp delivery state", error);
          return Response.json({ error: "Unable to store delivery state; retry the delivery." }, { status: 500 });
        }
      }
    }
  }

  // Events are already stored, so a failure here is recovered by the job runner instead of losing the message.
  after(async () => {
    for (const id of conversationIds) {
      await processConversation(id).catch((error) => console.error("WhatsApp processing failed", error));
    }
    await dispatchOutbox().catch((error) => console.error("WhatsApp dispatch failed", error));
  });

  return Response.json({ ok: true, processed, duplicates });
}
