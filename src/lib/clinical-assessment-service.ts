import { AppointmentStatus, type Prisma } from "@prisma/client";
import type { ClinicalAssessmentRecord, ClinicalAssessmentValues } from "@/lib/clinical-assessment";

type Tx = Prisma.TransactionClient;
type Scope = { clinicId: string; doctorId: string; appointmentId: string };

const assessmentSelect = {
  id: true,
  bpSystolic: true,
  bpDiastolic: true,
  pulseRate: true,
  spo2: true,
  weightKg: true,
  heightCm: true,
  maritalStatus: true,
  chiefComplaints: true,
  medicalHistory: true,
  surgicalHistory: true,
  comorbidities: true,
  comorbidityOther: true,
  habits: true,
  habitDetails: true,
  drugAllergy: true,
  drugAllergyDetails: true,
  investigationsAdded: true,
  investigationsReview: true,
  provisionalDiagnosis: true,
  treatment: true,
  reviewNotes: true,
  advice: true,
  discussed: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ClinicalAssessmentSelect;

type Row = Prisma.ClinicalAssessmentGetPayload<{ select: typeof assessmentSelect }>;

function toRecord(row: Row): ClinicalAssessmentRecord {
  return {
    ...row,
    weightKg: row.weightKg === null ? null : Number(row.weightKg),
    heightCm: row.heightCm === null ? null : Number(row.heightCm),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// The assessment follows the consultation's rules: only the assigned doctor sees it, and it can be
// changed only while the visit is in consultation and its consultation has not been completed.
async function visitFor(tx: Tx, scope: Scope) {
  return tx.appointment.findFirst({
    where: { id: scope.appointmentId, clinicId: scope.clinicId, doctorId: scope.doctorId },
    select: { id: true, patientId: true, status: true, consultation: { select: { completedAt: true } } },
  });
}

function isEditable(visit: NonNullable<Awaited<ReturnType<typeof visitFor>>>) {
  return visit.status === AppointmentStatus.IN_CONSULTATION && !visit.consultation?.completedAt;
}

export async function loadAssessment(tx: Tx, scope: Scope) {
  const visit = await visitFor(tx, scope);
  if (!visit) return { ok: false as const, status: 404, error: "Appointment not found." };
  const row = await tx.clinicalAssessment.findFirst({
    where: { appointmentId: visit.id, clinicId: scope.clinicId },
    select: assessmentSelect,
  });
  return { ok: true as const, assessment: row ? toRecord(row) : null, editable: isEditable(visit) };
}

export async function saveAssessment(
  tx: Tx,
  input: Scope & { userId: string | null; values: ClinicalAssessmentValues; expectedUpdatedAt: string | null },
) {
  const visit = await visitFor(tx, input);
  if (!visit) return { ok: false as const, status: 404, error: "Appointment not found." };
  if (visit.status !== AppointmentStatus.IN_CONSULTATION) {
    return { ok: false as const, status: 409, error: "Start this visit before editing its clinical assessment." };
  }
  if (visit.consultation?.completedAt) {
    return { ok: false as const, status: 409, error: "This visit is complete, so its clinical assessment can no longer be edited." };
  }

  const existing = await tx.clinicalAssessment.findFirst({
    where: { appointmentId: visit.id, clinicId: input.clinicId },
    select: { id: true, updatedAt: true },
  });
  const conflict = { ok: false as const, status: 409, error: "This assessment was changed by someone else after you opened it. Reload to see the latest version before saving." };

  let row: Row;
  if (!existing) {
    if (input.expectedUpdatedAt) return conflict;
    row = await tx.clinicalAssessment.create({
      data: { clinicId: input.clinicId, appointmentId: visit.id, patientId: visit.patientId, doctorId: input.doctorId, ...input.values },
      select: assessmentSelect,
    });
  } else {
    if (!input.expectedUpdatedAt) return conflict;
    // Conditional update: only applies if nobody saved since the doctor loaded this version.
    const updated = await tx.clinicalAssessment.updateMany({
      where: { id: existing.id, clinicId: input.clinicId, updatedAt: new Date(input.expectedUpdatedAt) },
      data: input.values,
    });
    if (updated.count === 0) return conflict;
    row = await tx.clinicalAssessment.findUniqueOrThrow({ where: { id: existing.id }, select: assessmentSelect });
  }

  await tx.auditLog.create({
    data: {
      clinicId: input.clinicId,
      userId: input.userId,
      action: existing ? "CLINICAL_ASSESSMENT_UPDATED" : "CLINICAL_ASSESSMENT_CREATED",
      entity: "ClinicalAssessment",
      entityId: row.id,
    },
  });
  return { ok: true as const, assessment: toRecord(row) };
}
