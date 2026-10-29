import { Prisma, ScheduledJobStatus } from "@prisma/client";
import { z } from "zod";
import { withWorker } from "@/lib/tenant-db";
import { dispatchOutbox } from "@/lib/whatsapp/outbox";
import { recoverPendingEvents } from "@/lib/whatsapp/events";
import { safeEqualString } from "@/lib/whatsapp-signature.mjs";

const holdPayload = z.object({ holdId: z.string().uuid() });
const followUpPayload = z.object({ followUpId: z.string().uuid() });
const batchSize = 20;
const maxAttempts = 5;

type ClaimedJob = { id: string; clinicId: string; type: string; payload: Prisma.JsonValue; attempts: number };

function retryDelayMs(attempts: number) {
  return Math.min(30_000 * 2 ** Math.max(attempts - 1, 0), 60 * 60_000);
}

async function processJob(job: ClaimedJob): Promise<boolean> {
  if (job.type === "EXPIRE_HOLD") {
    const payload = holdPayload.safeParse(job.payload);
    if (!payload.success) throw new Error("EXPIRE_HOLD payload must include a valid holdId.");
    await withWorker(async (tx) => {
      const hold = await tx.appointmentHold.findFirst({
        where: { id: payload.data.holdId, clinicId: job.clinicId, status: "ACTIVE" },
        select: { id: true, expiresAt: true },
      });
      if (!hold) return true;
      if (hold.expiresAt > new Date()) {
        await tx.scheduledJob.update({
          where: { id: job.id },
          data: { status: ScheduledJobStatus.PENDING, runAt: hold.expiresAt, lockedAt: null },
        });
        return false;
      }
      await tx.scheduleBlock.deleteMany({ where: { holdId: hold.id, clinicId: job.clinicId } });
      await tx.appointmentHold.update({ where: { id: hold.id }, data: { status: "EXPIRED" } });
    });
    return true;
  }

  if (job.type === "ESCALATE_FOLLOW_UP") {
    const payload = followUpPayload.safeParse(job.payload);
    if (!payload.success) throw new Error("ESCALATE_FOLLOW_UP payload must include a valid followUpId.");
    await withWorker(async (tx) => {
      const followUp = await tx.followUp.findFirst({
        where: { id: payload.data.followUpId, clinicId: job.clinicId, status: "OPEN" },
        select: { id: true, createdAt: true, escalatedAt: true },
      });
      if (!followUp || followUp.escalatedAt) return true;
      const escalationAt = new Date(followUp.createdAt.valueOf() + 7 * 24 * 60 * 60_000);
      if (escalationAt > new Date()) {
        await tx.scheduledJob.update({
          where: { id: job.id },
          data: { status: ScheduledJobStatus.PENDING, runAt: escalationAt, lockedAt: null },
        });
        return false;
      }
      await tx.followUp.update({ where: { id: followUp.id }, data: { escalatedAt: new Date() } });
    });
    return true;
  }

  throw new Error(`Unsupported scheduled job type: ${job.type}`);
}

// Vercel cron issues GET requests, so both verbs run the same authenticated handler.
export const GET = run;
export const POST = run;

async function run(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ error: "Scheduled processing is not configured." }, { status: 503 });
  }
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!safeEqualString(token, secret)) {
    return Response.json({ error: "Invalid job runner credentials." }, { status: 401 });
  }

  try {
    const scheduled = await withWorker(async (tx) => {
      const [holds, followUps] = await Promise.all([
        tx.appointmentHold.findMany({
          where: { status: "ACTIVE" },
          select: { id: true, clinicId: true, expiresAt: true },
          take: 1000,
        }),
        tx.followUp.findMany({
          where: { status: "OPEN", escalatedAt: null },
          select: { id: true, clinicId: true, createdAt: true },
          take: 1000,
        }),
      ]);
      const scheduledHolds = await tx.scheduledJob.createMany({
        data: holds.map((hold) => ({
          clinicId: hold.clinicId,
          type: "EXPIRE_HOLD",
          idempotencyKey: `expire-hold:${hold.id}`,
          payload: { holdId: hold.id },
          runAt: hold.expiresAt,
        })),
        skipDuplicates: true,
      });
      const scheduledFollowUps = await tx.scheduledJob.createMany({
        data: followUps.map((followUp) => ({
          clinicId: followUp.clinicId,
          type: "ESCALATE_FOLLOW_UP",
          idempotencyKey: `escalate-follow-up:${followUp.id}`,
          payload: { followUpId: followUp.id },
          runAt: new Date(followUp.createdAt.valueOf() + 7 * 24 * 60 * 60_000),
        })),
        skipDuplicates: true,
      });
      return scheduledHolds.count + scheduledFollowUps.count;
    });
    const claimed = await withWorker((tx) =>
      tx.$queryRaw<ClaimedJob[]>`
        WITH due_jobs AS (
          SELECT "id"
          FROM "ScheduledJob"
          WHERE (
            "status" = 'PENDING'::"ScheduledJobStatus"
            AND "runAt" <= CURRENT_TIMESTAMP
          ) OR (
            "status" = 'PROCESSING'::"ScheduledJobStatus"
            AND "lockedAt" < CURRENT_TIMESTAMP - INTERVAL '5 minutes'
          )
          ORDER BY "runAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${batchSize}
        )
        UPDATE "ScheduledJob" AS job
        SET "status" = 'PROCESSING'::"ScheduledJobStatus",
            "lockedAt" = CURRENT_TIMESTAMP,
            "attempts" = job."attempts" + 1,
            "updatedAt" = CURRENT_TIMESTAMP
        FROM due_jobs
        WHERE job."id" = due_jobs."id"
        RETURNING job."id", job."clinicId", job."type", job."payload", job."attempts"
      `,
    );
    let completed = 0;
    let failed = 0;
    let rescheduled = 0;

    for (const job of claimed) {
      try {
        const processed = await processJob(job);
        if (!processed) {
          rescheduled += 1;
          continue;
        }
        await withWorker((tx) =>
          tx.scheduledJob.updateMany({
            where: { id: job.id, status: ScheduledJobStatus.PROCESSING },
            data: { status: ScheduledJobStatus.COMPLETED, completedAt: new Date(), lockedAt: null, lastError: null },
          }),
        );
        completed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 1000) : "Unknown job processing error.";
        const isPermanent = job.attempts >= maxAttempts || message.startsWith("Unsupported scheduled job type:");
        await withWorker((tx) =>
          tx.scheduledJob.updateMany({
            where: { id: job.id, status: ScheduledJobStatus.PROCESSING },
            data: {
              status: isPermanent ? ScheduledJobStatus.FAILED : ScheduledJobStatus.PENDING,
              runAt: new Date(Date.now() + retryDelayMs(job.attempts)),
              lockedAt: null,
              lastError: message,
            },
          }),
        );
        console.error("Scheduled job processing failed", { jobId: job.id, type: job.type, message, isPermanent });
        failed += 1;
      }
    }

    const recoveredEvents = await recoverPendingEvents();
    const outbox = await dispatchOutbox();
    return Response.json({ scheduled, claimed: claimed.length, completed, failed, rescheduled, recoveredEvents, outbox });
  } catch (error) {
    console.error("Scheduled job batch failed", error);
    return Response.json({ error: "Unable to process scheduled jobs." }, { status: 500 });
  }
}
