import { ClinicRole } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AuthenticationError, requireClinicUser } from "@/lib/auth";
import { withClinic } from "@/lib/tenant-db";
import { ingestInbound, processConversation } from "@/lib/whatsapp/events";
import { dispatchOutbox } from "@/lib/whatsapp/outbox";

const bodySchema = z.object({
  phone: z.string().regex(/^\d{10,15}$/),
  text: z.string().max(1000).default(""),
  optionId: z.string().max(300).optional(),
  displayName: z.string().max(80).optional(),
});

function disabled() {
  return process.env.DOC_DESK_SIMULATOR !== "enabled" && process.env.NODE_ENV === "production";
}

async function transcript(context: Awaited<ReturnType<typeof requireClinicUser>>, phone: string) {
  return withClinic(context, async (tx) => {
    const conversation = await tx.whatsAppConversation.findFirst({
      where: { clinicId: context.clinicId, phone, isSimulated: true },
      select: { id: true, state: true, mode: true },
    });
    if (!conversation) return { conversation: null, messages: [] };
    const messages = await tx.whatsAppMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: [{ seq: "asc" }],
      take: 200,
      select: { id: true, direction: true, sender: true, body: true, status: true, interactive: true, createdAt: true, errorCode: true },
    });
    return { conversation, messages };
  });
}

function authFailure(error: unknown) {
  if (error instanceof AuthenticationError) return Response.json({ error: error.message }, { status: error.status });
  console.error("Simulator request failed", error);
  return Response.json({ error: "Simulator request failed." }, { status: 500 });
}

export async function GET(request: Request) {
  if (disabled()) return Response.json({ error: "The simulator is disabled." }, { status: 404 });
  try {
    const context = await requireClinicUser([ClinicRole.ADMIN, ClinicRole.RECEPTIONIST]);
    const phone = new URL(request.url).searchParams.get("phone") ?? "";
    if (!/^\d{10,15}$/.test(phone)) return Response.json({ error: "Invalid phone." }, { status: 400 });
    return Response.json(await transcript(context, phone));
  } catch (error) {
    return authFailure(error);
  }
}

export async function POST(request: Request) {
  if (disabled()) return Response.json({ error: "The simulator is disabled." }, { status: 404 });
  try {
    const context = await requireClinicUser([ClinicRole.ADMIN, ClinicRole.RECEPTIONIST]);
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Enter a 10–15 digit phone number and a message." }, { status: 400 });
    const { phone, text, optionId, displayName } = parsed.data;
    const real = await withClinic(context, (tx) =>
      tx.whatsAppConversation.findFirst({ where: { clinicId: context.clinicId, phone, isSimulated: false }, select: { id: true } }),
    );
    if (real) return Response.json({ error: "That number belongs to a real conversation. Use a different test number." }, { status: 409 });
    const result = await ingestInbound({
      clinicId: context.clinicId,
      phone,
      eventKey: `sim:${randomUUID()}`,
      text,
      optionId,
      displayName,
      simulated: true,
    });
    if (result.conversationId) {
      await processConversation(result.conversationId);
      await dispatchOutbox();
    }
    return Response.json(await transcript(context, phone));
  } catch (error) {
    return authFailure(error);
  }
}
