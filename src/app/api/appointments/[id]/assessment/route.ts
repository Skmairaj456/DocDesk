import { ClinicRole, Prisma } from "@prisma/client";
import { AuthenticationError, requireClinicUser } from "@/lib/auth";
import { firstIssue, saveAssessmentRequestSchema } from "@/lib/clinical-assessment";
import { loadAssessment, saveAssessment } from "@/lib/clinical-assessment-service";
import { withClinic } from "@/lib/tenant-db";

// Clinical assessment for one visit. Same access as the consultation note: the assigned doctor only.

async function doctorContext() {
  const context = await requireClinicUser([ClinicRole.DOCTOR]);
  if (!context.doctorProfileId) return { context, doctorId: null };
  return { context, doctorId: context.doctorProfileId };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { context, doctorId } = await doctorContext();
    if (!doctorId) return Response.json({ error: "A doctor profile is required." }, { status: 403 });
    const { id } = await params;
    const result = await withClinic(context, (tx) => loadAssessment(tx, { clinicId: context.clinicId, doctorId, appointmentId: id }));
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ assessment: result.assessment, editable: result.editable });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Clinical assessment load failed", error);
    return Response.json({ error: "Unable to load the clinical assessment." }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { context, doctorId } = await doctorContext();
    if (!doctorId) return Response.json({ error: "A doctor profile is required." }, { status: 403 });
    const { id } = await params;
    const parsed = saveAssessmentRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ error: firstIssue(parsed.error), details: parsed.error.flatten() }, { status: 400 });
    }
    const result = await withClinic(context, (tx) =>
      saveAssessment(tx, {
        clinicId: context.clinicId,
        doctorId,
        appointmentId: id,
        userId: context.userId,
        values: parsed.data.assessment,
        expectedUpdatedAt: parsed.data.expectedUpdatedAt,
      }),
    );
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ assessment: result.assessment });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return Response.json({ error: "This visit already has a clinical assessment. Reload to see it before saving." }, { status: 409 });
    }
    console.error("Clinical assessment save failed", error);
    return Response.json({ error: "Unable to save the clinical assessment." }, { status: 500 });
  }
}
