import { AppointmentStatus, ClinicRole, FollowUpStatus, FollowUpType, Prisma, VisitOutcome } from "@prisma/client";
import { z } from "zod";
import { AuthenticationError, requireClinicUser } from "@/lib/auth";
import { withClinic } from "@/lib/tenant-db";

const consultationInput = z.object({
  note: z.string().trim().min(1).max(10_000),
  complete: z.boolean(),
  outcome: z.nativeEnum(VisitOutcome).nullable(),
  followUp: z.object({
    dueAt: z.string().datetime({ offset: true }),
    type: z.nativeEnum(FollowUpType),
    reason: z.string().trim().min(1).max(500),
  }).nullable(),
}).superRefine((value, context) => {
  if (value.complete && !value.outcome) {
    context.addIssue({ code: "custom", path: ["outcome"], message: "Choose an outcome before completing the visit." });
  }
  if (!value.complete && value.outcome) {
    context.addIssue({ code: "custom", path: ["outcome"], message: "An outcome can only be recorded when completing the visit." });
  }
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireClinicUser([ClinicRole.DOCTOR]);
    const doctorProfileId = context.doctorProfileId;
    if (!doctorProfileId) return Response.json({ error: "A doctor profile is required." }, { status: 403 });
    const { id } = await params;
    const details = await withClinic(context, async (tx) => {
      const appointment = await tx.appointment.findFirst({
        where: { id, clinicId: context.clinicId, doctorId: doctorProfileId },
        select: {
          id: true,
          status: true,
          patient: {
            select: {
              id: true,
              fullName: true,
              phone: true,
              dateOfBirth: true,
              sex: true,
              createdAt: true,
              consultations: {
                where: { clinicId: context.clinicId },
                select: {
                  id: true,
                  note: true,
                  outcome: true,
                  completedAt: true,
                  createdAt: true,
                  followUp: { select: { dueAt: true, type: true, status: true, reasonInternal: true } },
                },
                orderBy: { createdAt: "desc" },
              },
              appointments: {
                where: { clinicId: context.clinicId },
                select: {
                  id: true,
                  reference: true,
                  startsAt: true,
                  status: true,
                  visitType: true,
                  department: { select: { name: true } },
                  doctor: { select: { membership: { select: { user: { select: { displayName: true } } } } } },
                },
                orderBy: { startsAt: "desc" },
              },
            },
          },
          consultation: {
            select: {
              id: true,
              note: true,
              outcome: true,
              completedAt: true,
              followUp: { select: { dueAt: true, type: true, reasonInternal: true, status: true } },
            },
          },
        },
      });
      return appointment;
    });
    if (!details) return Response.json({ error: "Appointment not found." }, { status: 404 });
    return Response.json({
      appointmentStatus: details.status,
      patient: {
        ...details.patient,
        dateOfBirth: details.patient.dateOfBirth?.toISOString() ?? null,
        createdAt: details.patient.createdAt.toISOString(),
        appointments: details.patient.appointments.map((appointment) => ({
          id: appointment.id,
          reference: appointment.reference,
          startsAt: appointment.startsAt.toISOString(),
          status: appointment.status,
          visitType: appointment.visitType,
          department: appointment.department,
          doctorName: appointment.doctor.membership.user.displayName,
        })),
        consultations: details.patient.consultations.map((consultation) => ({
          ...consultation,
          createdAt: consultation.createdAt.toISOString(),
          completedAt: consultation.completedAt?.toISOString() ?? null,
          followUp: consultation.followUp ? {
            ...consultation.followUp,
            dueAt: consultation.followUp.dueAt.toISOString(),
          } : null,
        })),
      },
      consultation: details.consultation ? {
        ...details.consultation,
        completedAt: details.consultation.completedAt?.toISOString() ?? null,
        followUp: details.consultation.followUp ? {
          ...details.consultation.followUp,
          dueAt: details.consultation.followUp.dueAt.toISOString(),
        } : null,
      } : null,
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("Consultation record load failed", error);
    return Response.json({ error: "Unable to load the consultation record." }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireClinicUser([ClinicRole.DOCTOR]);
    const doctorProfileId = context.doctorProfileId;
    if (!doctorProfileId) return Response.json({ error: "A doctor profile is required." }, { status: 403 });
    const { id } = await params;
    const parsed = consultationInput.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: "Invalid consultation details.", details: parsed.error.flatten() }, { status: 400 });
    }
    const dueAt = parsed.data.followUp ? new Date(parsed.data.followUp.dueAt) : null;
    if (dueAt && dueAt <= new Date()) {
      return Response.json({ error: "Choose a future follow-up date." }, { status: 400 });
    }

    const result = await withClinic(context, async (tx) => {
      const appointment = await tx.appointment.findFirst({
        where: {
          id,
          clinicId: context.clinicId,
          doctorId: doctorProfileId,
        },
        select: { id: true, patientId: true, departmentId: true, status: true },
      });
      if (!appointment) return { error: "Appointment not found." as const, status: 404 };
      if (appointment.status !== AppointmentStatus.IN_CONSULTATION) {
        return { error: "Start this visit before editing its consultation." as const, status: 409 };
      }

      const existing = await tx.consultation.findUnique({
        where: { appointmentId: appointment.id },
        select: { id: true, completedAt: true },
      });
      if (existing?.completedAt) {
        return { error: "This consultation is complete and can no longer be edited." as const, status: 409 };
      }
      if (parsed.data.followUp && existing) {
        const currentFollowUp = await tx.followUp.findUnique({
          where: { consultationId: existing.id },
          select: { status: true },
        });
        if (currentFollowUp && currentFollowUp.status !== FollowUpStatus.OPEN) {
          return { error: "This consultation’s follow-up has already been booked or resolved." as const, status: 409 };
        }
      }

      const consultation = await tx.consultation.upsert({
        where: { appointmentId: appointment.id },
        create: {
          clinicId: context.clinicId,
          appointmentId: appointment.id,
          patientId: appointment.patientId,
          doctorId: doctorProfileId,
          note: parsed.data.note,
          outcome: parsed.data.outcome,
          ...(parsed.data.complete ? { completedAt: new Date() } : {}),
        },
        update: {
          note: parsed.data.note,
          outcome: parsed.data.outcome,
          ...(parsed.data.complete ? { completedAt: new Date() } : {}),
        },
        select: { id: true, note: true, outcome: true, completedAt: true },
      });

      if (parsed.data.followUp && dueAt) {
        await tx.followUp.upsert({
          where: { consultationId: consultation.id },
          create: {
            clinicId: context.clinicId,
            consultationId: consultation.id,
            patientId: appointment.patientId,
            departmentId: appointment.departmentId,
            responsibleDoctorId: doctorProfileId,
            dueAt,
            type: parsed.data.followUp.type,
            reasonInternal: parsed.data.followUp.reason,
          },
          update: {
            dueAt,
            type: parsed.data.followUp.type,
            reasonInternal: parsed.data.followUp.reason,
          },
        });
      }

      if (parsed.data.complete) {
        await tx.appointment.update({
          where: { id: appointment.id },
          data: { status: AppointmentStatus.COMPLETED },
        });
      }
      await tx.auditLog.create({
        data: {
          clinicId: context.clinicId,
          userId: context.userId,
          action: parsed.data.complete ? "CONSULTATION_COMPLETED" : "CONSULTATION_DRAFT_SAVED",
          entity: "Consultation",
          entityId: consultation.id,
        },
      });
      return { consultation };
    });

    if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ consultation: result.consultation });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return Response.json({ error: "This appointment already has a consultation. Refresh and try again." }, { status: 409 });
    }
    console.error("Consultation save failed", error);
    return Response.json({ error: "Unable to save the consultation." }, { status: 500 });
  }
}
