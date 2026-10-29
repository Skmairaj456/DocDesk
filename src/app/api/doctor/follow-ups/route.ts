import { ClinicRole, FollowUpStatus } from "@prisma/client";
import { AuthenticationError, requireClinicUser } from "@/lib/auth";
import { withClinic } from "@/lib/tenant-db";

export async function GET(request: Request) {
  void request.url;
  try {
    const context = await requireClinicUser([ClinicRole.DOCTOR]);
    const doctorProfileId = context.doctorProfileId;
    if (!doctorProfileId) return Response.json({ error: "A doctor profile is required." }, { status: 403 });
    const followUps = await withClinic(context, (tx) =>
      tx.followUp.findMany({
        where: {
          clinicId: context.clinicId,
          responsibleDoctorId: doctorProfileId,
          status: { in: [FollowUpStatus.OPEN, FollowUpStatus.BOOKED] },
        },
        select: {
          id: true,
          dueAt: true,
          type: true,
          reasonInternal: true,
          status: true,
          patient: { select: { id: true, fullName: true, phone: true } },
          department: { select: { id: true, name: true } },
          bookedAppointment: { select: { startsAt: true, reference: true } },
        },
        orderBy: [{ status: "asc" }, { dueAt: "asc" }],
        take: 100,
      }),
    );
    return Response.json({
      followUps: followUps.map((followUp) => ({
        ...followUp,
        dueAt: followUp.dueAt.toISOString(),
        bookedAppointment: followUp.bookedAppointment
          ? { ...followUp.bookedAppointment, startsAt: followUp.bookedAppointment.startsAt.toISOString() }
          : null,
      })),
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("Doctor follow-up list failed", error);
    return Response.json({ error: "Unable to load follow-up tasks." }, { status: 500 });
  }
}
