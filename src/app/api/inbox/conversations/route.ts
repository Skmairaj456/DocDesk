import { ClinicRole } from "@prisma/client";
import { AuthenticationError, requireClinicUser } from "@/lib/auth";
import { withClinic } from "@/lib/tenant-db";

export async function GET(request: Request) {
  void request.url;
  try {
    const context = await requireClinicUser([ClinicRole.ADMIN, ClinicRole.RECEPTIONIST]);
    const conversations = await withClinic(context, (tx) =>
      tx.whatsAppConversation.findMany({
        where: { clinicId: context.clinicId },
        orderBy: { lastMessageAt: "desc" },
        take: 50,
        select: {
          id: true,
          phone: true,
          displayName: true,
          mode: true,
          state: true,
          isSimulated: true,
          optedOutAt: true,
          lastMessageAt: true,
          patient: { select: { id: true, fullName: true } },
          assignedMembership: { select: { id: true, user: { select: { displayName: true } } } },
          messages: { orderBy: { seq: "desc" }, take: 1, select: { body: true, direction: true } },
        },
      }),
    );
    return Response.json({ conversations });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Inbox list failed", error);
    return Response.json({ error: "Unable to load conversations." }, { status: 500 });
  }
}
