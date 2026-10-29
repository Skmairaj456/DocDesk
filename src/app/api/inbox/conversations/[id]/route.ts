import { ClinicRole, ConversationMode, ConversationState, MessageSender, MessageStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AuthenticationError, requireClinicUser } from "@/lib/auth";
import { withClinic } from "@/lib/tenant-db";
import { dispatchOutbox } from "@/lib/whatsapp/outbox";

const idSchema = z.string().uuid();
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reply"), text: z.string().trim().min(1).max(1500) }),
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("assign"), membershipId: z.string().uuid().nullable() }),
]);

type Params = { params: Promise<{ id: string }> };

function failure(error: unknown) {
  if (error instanceof AuthenticationError) return Response.json({ error: error.message }, { status: error.status });
  console.error("Inbox request failed", error);
  return Response.json({ error: "Unable to complete the inbox request." }, { status: 500 });
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const context = await requireClinicUser([ClinicRole.ADMIN, ClinicRole.RECEPTIONIST]);
    const id = idSchema.safeParse((await params).id);
    if (!id.success) return Response.json({ error: "Invalid conversation." }, { status: 400 });
    const data = await withClinic(context, async (tx) => {
      const conversation = await tx.whatsAppConversation.findFirst({
        where: { id: id.data, clinicId: context.clinicId },
        select: {
          id: true, phone: true, displayName: true, mode: true, state: true, isSimulated: true, optedOutAt: true,
          assignedMembership: { select: { id: true, user: { select: { displayName: true } } } },
          patient: { select: { id: true, fullName: true, registrationStatus: true } },
        },
      });
      if (!conversation) return null;
      const [messages, appointments, staff] = await Promise.all([
        tx.whatsAppMessage.findMany({
          where: { conversationId: conversation.id },
          orderBy: { seq: "asc" },
          take: 200,
          select: { id: true, direction: true, sender: true, body: true, status: true, errorCode: true, createdAt: true },
        }),
        conversation.patient
          ? tx.appointment.findMany({
              where: { clinicId: context.clinicId, patientId: conversation.patient.id },
              orderBy: { startsAt: "desc" },
              take: 5,
              select: { id: true, reference: true, startsAt: true, status: true, source: true },
            })
          : Promise.resolve([]),
        tx.membership.findMany({
          where: { clinicId: context.clinicId, role: { in: [ClinicRole.ADMIN, ClinicRole.RECEPTIONIST] } },
          select: { id: true, user: { select: { displayName: true } } },
        }),
      ]);
      return { conversation, messages, appointments, staff };
    });
    if (!data) return Response.json({ error: "Conversation not found." }, { status: 404 });
    return Response.json(data);
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const context = await requireClinicUser([ClinicRole.ADMIN, ClinicRole.RECEPTIONIST]);
    const id = idSchema.safeParse((await params).id);
    const body = actionSchema.safeParse(await request.json());
    if (!id.success || !body.success) return Response.json({ error: "Invalid request." }, { status: 400 });
    const action = body.data;

    const outcome = await withClinic(context, async (tx) => {
      const conversation = await tx.whatsAppConversation.findFirst({
        where: { id: id.data, clinicId: context.clinicId },
        select: { id: true },
      });
      if (!conversation) return "NOT_FOUND" as const;
      const me = await tx.membership.findFirst({ where: { clinicId: context.clinicId, userId: context.userId }, select: { id: true } });

      if (action.action === "assign") {
        if (action.membershipId) {
          const target = await tx.membership.findFirst({
            where: { id: action.membershipId, clinicId: context.clinicId, role: { in: [ClinicRole.ADMIN, ClinicRole.RECEPTIONIST] } },
            select: { id: true },
          });
          if (!target) return "BAD_ASSIGNEE" as const;
        }
        await tx.whatsAppConversation.update({ where: { id: conversation.id }, data: { assignedMembershipId: action.membershipId } });
      } else if (action.action === "resume") {
        await tx.whatsAppConversation.update({
          where: { id: conversation.id },
          data: { mode: ConversationMode.BOT, state: ConversationState.MAIN_MENU, context: { stack: [] }, stateUpdatedAt: new Date(), version: { increment: 1 }, assignedMembershipId: null },
        });
      } else {
        await tx.whatsAppConversation.update({
          where: { id: conversation.id },
          data: { mode: ConversationMode.HUMAN, state: ConversationState.HUMAN_HANDOVER, version: { increment: 1 }, ...(me ? { assignedMembershipId: me.id } : {}) },
        });
        if (action.action === "reply") {
          await tx.whatsAppMessage.create({
            data: {
              conversationId: conversation.id,
              direction: "OUTBOUND",
              sender: MessageSender.STAFF,
              body: action.text,
              status: MessageStatus.QUEUED,
              kind: "STAFF",
              idempotencyKey: `staff:${randomUUID()}`,
            },
          });
        }
      }
      await tx.auditLog.create({
        data: { clinicId: context.clinicId, userId: context.userId, action: `CONVERSATION_${action.action.toUpperCase()}`, entity: "WhatsAppConversation", entityId: conversation.id },
      });
      return "OK" as const;
    });
    if (outcome === "NOT_FOUND") return Response.json({ error: "Conversation not found." }, { status: 404 });
    if (outcome === "BAD_ASSIGNEE") return Response.json({ error: "That person can't be assigned." }, { status: 400 });
    if (action.action === "reply") await dispatchOutbox().catch((error) => console.error("Inbox dispatch failed", error));
    return Response.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
