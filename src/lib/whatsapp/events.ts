import { ConversationMode, ConversationState, MessageSender, MessageStatus, Prisma, WebhookEventStatus } from "@prisma/client";
import { withWorker } from "@/lib/tenant-db";
import { runEngine } from "@/lib/whatsapp/engine";

export const MAX_EVENT_ATTEMPTS = 5;
const MAX_EVENTS_PER_RUN = 25;

export type InboundInput = {
  clinicId: string;
  phone: string;
  eventKey: string;
  text: string;
  optionId?: string;
  displayName?: string;
  simulated?: boolean;
  externalId?: string;
};

export type IngestResult = { duplicate: boolean; conversationId: string | null };

// Stores the event, the conversation and the inbound message atomically. Duplicate deliveries are detected by the unique event key.
export async function ingestInbound(input: InboundInput): Promise<IngestResult> {
  return withWorker(async (tx) => {
    const created = await tx.webhookEvent.createMany({
      data: [
        {
          clinicId: input.clinicId,
          externalEventKey: input.eventKey,
          eventType: "INBOUND_MESSAGE",
          status: WebhookEventStatus.RECEIVED,
          payload: { text: input.text.slice(0, 4096), optionId: input.optionId ?? null } as Prisma.InputJsonValue,
        },
      ],
      skipDuplicates: true,
    });
    if (created.count === 0) return { duplicate: true, conversationId: null };

    const now = new Date();
    const conversation = await tx.whatsAppConversation.upsert({
      where: { clinicId_phone: { clinicId: input.clinicId, phone: input.phone } },
      update: {
        lastMessageAt: now,
        lastInboundAt: now,
        ...(input.displayName ? { displayName: input.displayName } : {}),
      },
      create: {
        clinicId: input.clinicId,
        phone: input.phone,
        lastMessageAt: now,
        lastInboundAt: now,
        displayName: input.displayName,
        isSimulated: Boolean(input.simulated),
      },
      select: { id: true },
    });
    await tx.whatsAppMessage.create({
      data: {
        conversationId: conversation.id,
        direction: "INBOUND",
        sender: MessageSender.PATIENT,
        body: (input.text || "Empty message").slice(0, 4096),
        status: MessageStatus.RECEIVED,
        externalId: input.externalId,
        isSimulated: Boolean(input.simulated),
      },
    });
    await tx.webhookEvent.update({
      where: { externalEventKey: input.eventKey },
      data: { conversationId: conversation.id },
    });
    return { duplicate: false, conversationId: conversation.id };
  });
}

function backoffMs(attempts: number) {
  return Math.min(5 * 60_000, 2_000 * 2 ** attempts);
}

function safeError(error: unknown) {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.replace(/\s+/g, " ").slice(0, 300);
}

type Pending = { id: string; externalEventKey: string; payload: Prisma.JsonValue; attempts: number };

async function processNext(conversationId: string, now: Date): Promise<"done" | "empty" | "retry"> {
  let pending: Pending | null = null;
  try {
    return await withWorker(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "WhatsAppConversation" WHERE "id" = ${conversationId}::uuid FOR UPDATE`;
      // Strict per-conversation order: only the oldest unfinished event may run.
      const event = await tx.webhookEvent.findFirst({
        where: {
          conversationId,
          eventType: "INBOUND_MESSAGE",
          status: { in: [WebhookEventStatus.RECEIVED, WebhookEventStatus.FAILED] },
          attempts: { lt: MAX_EVENT_ATTEMPTS },
        },
        orderBy: { createdAt: "asc" },
      });
      if (!event) return "empty" as const;
      if (event.nextAttemptAt && event.nextAttemptAt > now) return "empty" as const;
      pending = event;
      const conversation = await tx.whatsAppConversation.findUniqueOrThrow({ where: { id: conversationId }, select: { clinicId: true } });
      const payload = (event.payload ?? {}) as { text?: string; optionId?: string | null };
      await runEngine(tx, {
        clinicId: conversation.clinicId,
        conversationId,
        eventKey: event.externalEventKey,
        input: { text: payload.text ?? "", optionId: payload.optionId ?? undefined },
        now,
      });
      await tx.webhookEvent.update({
        where: { id: event.id },
        data: { status: WebhookEventStatus.PROCESSED, processedAt: new Date(), lastError: null },
      });
      return "done" as const;
    }, { timeout: 30_000 });
  } catch (error) {
    const failed = pending as Pending | null;
    if (failed) await recordFailure(conversationId, failed, error);
    return "retry";
  }
}

async function recordFailure(conversationId: string, event: Pending, error: unknown) {
  const attempts = event.attempts + 1;
  console.error("WhatsApp event processing failed", event.id, safeError(error));
  await withWorker(async (tx) => {
    await tx.webhookEvent.update({
      where: { id: event.id },
      data: {
        status: WebhookEventStatus.FAILED,
        attempts,
        lastError: safeError(error),
        nextAttemptAt: new Date(Date.now() + backoffMs(attempts)),
      },
    });
    if (attempts >= MAX_EVENT_ATTEMPTS) {
      // Retries are exhausted: tell the patient and hand over to a person instead of leaving them in silence.
      await tx.whatsAppConversation.update({
        where: { id: conversationId },
        data: { mode: ConversationMode.HUMAN, state: ConversationState.HUMAN_HANDOVER, version: { increment: 1 } },
      });
      await tx.whatsAppMessage.createMany({
        data: [
          {
            conversationId,
            direction: "OUTBOUND",
            sender: MessageSender.BOT,
            body: "Sorry, something went wrong on our side. I've passed your chat to our reception team and they'll reply here.",
            status: MessageStatus.QUEUED,
            kind: "HANDOVER",
            idempotencyKey: `${event.externalEventKey}:dead`,
          },
        ],
        skipDuplicates: true,
      });
    }
  }).catch((inner) => console.error("Could not record WhatsApp failure", safeError(inner)));
}

// Processes queued inbound events for one conversation in order.
export async function processConversation(conversationId: string, now = new Date()): Promise<number> {
  let handled = 0;
  for (let i = 0; i < MAX_EVENTS_PER_RUN; i += 1) {
    const result = await processNext(conversationId, now);
    if (result !== "done") break;
    handled += 1;
  }
  return handled;
}

// Used by the job runner to recover events that were stored but never processed (e.g. a crash after ingest).
export async function recoverPendingEvents(limit = 20, concurrency = 4, now = new Date()): Promise<number> {
  const rows = await withWorker((tx) =>
    tx.webhookEvent.findMany({
      where: {
        eventType: "INBOUND_MESSAGE",
        conversationId: { not: null },
        status: { in: [WebhookEventStatus.RECEIVED, WebhookEventStatus.FAILED] },
        attempts: { lt: MAX_EVENT_ATTEMPTS },
        createdAt: { lt: new Date(now.valueOf() - 5_000) },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
      select: { conversationId: true },
      orderBy: { createdAt: "asc" },
      take: limit,
    }),
  );
  const ids = [...new Set(rows.map((row) => row.conversationId as string))];
  let handled = 0;
  for (let i = 0; i < ids.length; i += concurrency) {
    const counts = await Promise.all(ids.slice(i, i + concurrency).map((id) => processConversation(id, now)));
    handled += counts.reduce((sum, count) => sum + count, 0);
  }
  return handled;
}
