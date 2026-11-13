import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { withWorker } from "@/lib/tenant-db";
import { clinicalAssessmentSchema, emptyAssessment, type ClinicalAssessmentValues } from "@/lib/clinical-assessment";
import { loadAssessment, loadAssessmentHistory, saveAssessment } from "@/lib/clinical-assessment-service";

const run = randomUUID().slice(0, 8);
let clinicId = "";
let doctorId = "";
let otherDoctorId = "";
let departmentId = "";
let patientId = "";
let userId = "";
let counter = 0;

async function makeDoctor(name: string) {
  const user = await prisma.user.create({ data: { authSubject: randomUUID(), email: `${name}-${run}@example.test`, displayName: name } });
  const membership = await prisma.membership.create({ data: { clinicId, userId: user.id, role: "DOCTOR" } });
  const doctor = await prisma.doctorProfile.create({ data: { clinicId, membershipId: membership.id, consultationMinutes: 30 } });
  return { userId: user.id, doctorId: doctor.id };
}

async function makeVisit(status: "BOOKED" | "IN_CONSULTATION" | "COMPLETED" = "IN_CONSULTATION") {
  counter += 1;
  const startsAt = new Date(Date.UTC(2030, 0, 1, 3 + counter));
  return prisma.appointment.create({
    data: { clinicId, reference: `CA-${run}-${counter}`, patientId, departmentId, doctorId, startsAt, endsAt: new Date(startsAt.valueOf() + 30 * 60_000), status },
  });
}

function values(overrides: Partial<Record<keyof ClinicalAssessmentValues, unknown>>) {
  return clinicalAssessmentSchema.parse({ ...emptyAssessment(), ...overrides });
}

const save = (appointmentId: string, assessment: ClinicalAssessmentValues, expectedUpdatedAt: string | null, doctor = doctorId) =>
  withWorker((tx) => saveAssessment(tx, { clinicId, doctorId: doctor, appointmentId, userId, values: assessment, expectedUpdatedAt }));
const load = (appointmentId: string, doctor = doctorId) => withWorker((tx) => loadAssessment(tx, { clinicId, doctorId: doctor, appointmentId }));

before(async () => {
  const clinic = await prisma.clinic.create({ data: { name: `Assessment Clinic ${run}`, timezone: "Asia/Kolkata" } });
  clinicId = clinic.id;
  ({ doctorId, userId } = await makeDoctor("Dr. Assess"));
  ({ doctorId: otherDoctorId } = await makeDoctor("Dr. Other"));
  departmentId = (await prisma.department.create({ data: { clinicId, name: "General", code: `G${run}` } })).id;
  patientId = (await prisma.patient.create({ data: { clinicId, fullName: "Asha Rao", normalizedName: "asha rao", phone: "+919000000001", normalizedPhone: "919000000001" } })).id;
});

after(async () => {
  await prisma.$disconnect();
});

describe("Clinical assessment (real PostgreSQL)", () => {
  it("saves, reloads and updates an assessment for the visit's patient", async () => {
    const visit = await makeVisit();
    assert.deepEqual(await load(visit.id), { ok: true, assessment: null, editable: true });

    const first = values({
      bpSystolic: 130, bpDiastolic: 85, pulseRate: 80, spo2: 97, weightKg: 68.4, heightCm: 165,
      maritalStatus: "UNMARRIED", chiefComplaints: "Fever for 3 days",
      comorbidities: ["HTN", "THYROID", "OTHER"], comorbidityOther: "Migraine",
      habits: ["ALCOHOL", "SMOKING"], habitDetails: "Occasional",
      drugAllergy: true, drugAllergyDetails: "Sulfa drugs – hives",
      investigationsAdded: "CBC, CRP", provisionalDiagnosis: "Viral fever", treatment: "Paracetamol 650 mg TDS x 3 days",
      reviewNotes: "Review after 3 days", advice: "Fluids and rest", discussed: "Warning signs explained",
    });
    const created = await save(visit.id, first, null);
    assert.equal(created.ok, true);
    assert.ok(created.ok);
    assert.equal(created.assessment.weightKg, 68.4);
    assert.deepEqual(created.assessment.comorbidities, ["HTN", "THYROID", "OTHER"]);

    const reloaded = await load(visit.id);
    assert.ok(reloaded.ok && reloaded.assessment);
    assert.equal(reloaded.assessment.drugAllergyDetails, "Sulfa drugs – hives");
    assert.equal(reloaded.assessment.updatedAt, created.assessment.updatedAt);

    const row = await prisma.clinicalAssessment.findUniqueOrThrow({ where: { appointmentId: visit.id } });
    assert.equal(row.patientId, patientId);
    assert.equal(row.doctorId, doctorId);
    assert.equal(row.clinicId, clinicId);

    const updated = await save(visit.id, values({ ...first, drugAllergy: false, drugAllergyDetails: "Sulfa drugs – hives", investigationsReview: "CBC normal" }), created.assessment.updatedAt);
    assert.ok(updated.ok);
    assert.equal(updated.assessment.drugAllergy, false);
    assert.equal(updated.assessment.drugAllergyDetails, null, "details are cleared when allergy is No");
    assert.equal(updated.assessment.investigationsReview, "CBC normal");
    assert.equal(await prisma.clinicalAssessment.count({ where: { appointmentId: visit.id } }), 1, "no duplicate record");
    const audits = await prisma.auditLog.findMany({ where: { clinicId, entity: "ClinicalAssessment", entityId: updated.assessment.id }, orderBy: { createdAt: "asc" } });
    assert.deepEqual(audits.map((a) => a.action), ["CLINICAL_ASSESSMENT_CREATED", "CLINICAL_ASSESSMENT_UPDATED"]);
  });

  it("refuses to overwrite a newer version", async () => {
    const visit = await makeVisit();
    const created = await save(visit.id, values({ chiefComplaints: "First" }), null);
    assert.ok(created.ok);
    const second = await save(visit.id, values({ chiefComplaints: "Second" }), created.assessment.updatedAt);
    assert.ok(second.ok);
    const stale = await save(visit.id, values({ chiefComplaints: "Stale" }), created.assessment.updatedAt);
    assert.equal(stale.ok, false);
    assert.equal(!stale.ok && stale.status, 409);
    const again = await save(visit.id, values({ chiefComplaints: "Blind create" }), null);
    assert.equal(!again.ok && again.status, 409, "a new-assessment save cannot replace an existing one");
    const reloaded = await load(visit.id);
    assert.equal(reloaded.ok && reloaded.assessment?.chiefComplaints, "Second");
  });

  it("follows the consultation's rules for who and when", async () => {
    const booked = await makeVisit("BOOKED");
    const notStarted = await save(booked.id, values({}), null);
    assert.equal(!notStarted.ok && notStarted.status, 409);

    const visit = await makeVisit();
    assert.equal((await load(visit.id, otherDoctorId)).ok, false, "another doctor cannot read it");
    const otherSave = await save(visit.id, values({}), null, otherDoctorId);
    assert.equal(!otherSave.ok && otherSave.status, 404, "another doctor cannot write it");

    const created = await save(visit.id, values({ advice: "Rest" }), null);
    assert.ok(created.ok);
    await prisma.consultation.create({ data: { clinicId, appointmentId: visit.id, patientId, doctorId, note: "Seen", outcome: "STABLE", completedAt: new Date() } });
    await prisma.appointment.update({ where: { id: visit.id }, data: { status: "COMPLETED" } });
    const completed = await load(visit.id);
    assert.ok(completed.ok);
    assert.equal(completed.editable, false);
    assert.equal(completed.assessment?.advice, "Rest", "remains viewable after completion");
    const locked = await save(visit.id, values({ advice: "Changed" }), created.assessment.updatedAt);
    assert.equal(!locked.ok && locked.status, 409);
    const consultation = await prisma.consultation.findUniqueOrThrow({ where: { appointmentId: visit.id } });
    assert.equal(consultation.note, "Seen", "the consultation note is untouched");
  });

  it("lists a patient's earlier assessments for the care history, newest visit first", async () => {
    const earlier = await makeVisit();
    const later = await makeVisit();
    const current = await makeVisit();
    assert.ok((await save(earlier.id, values({ provisionalDiagnosis: "Acute gastritis" }), null)).ok);
    assert.ok((await save(later.id, values({ provisionalDiagnosis: "Viral fever", bpSystolic: 120, bpDiastolic: 80 }), null)).ok);
    assert.ok((await save(current.id, values({ provisionalDiagnosis: "Today" }), null)).ok);

    const history = await withWorker((tx) => loadAssessmentHistory(tx, { clinicId, patientId, excludeAppointmentId: current.id }));
    const mine = history.filter((entry) => [earlier.id, later.id, current.id].includes(entry.appointmentId));
    assert.deepEqual(mine.map((entry) => entry.provisionalDiagnosis), ["Viral fever", "Acute gastritis"], "current visit excluded, newest first");
    assert.equal(mine[0].bpSystolic, 120);
    assert.equal(mine[0].doctorName, "Dr. Assess");
    assert.equal(mine[0].visitStartsAt, later.startsAt.toISOString());

    const otherClinic = await prisma.clinic.create({ data: { name: `History Clinic ${run}`, timezone: "Asia/Kolkata" } });
    const elsewhere = await withWorker((tx) => loadAssessmentHistory(tx, { clinicId: otherClinic.id, patientId, excludeAppointmentId: current.id }));
    assert.equal(elsewhere.length, 0, "another clinic sees none of them");
  });

  it("keeps an assessment inside its own clinic", async () => {
    const visit = await makeVisit();
    const otherClinic = await prisma.clinic.create({ data: { name: `Other Clinic ${run}`, timezone: "Asia/Kolkata" } });
    await assert.rejects(
      prisma.clinicalAssessment.create({ data: { clinicId: otherClinic.id, appointmentId: visit.id, patientId, doctorId } }),
      /foreign key|tenant_fkey/i,
    );
    const wrongClinic = await withWorker((tx) => loadAssessment(tx, { clinicId: otherClinic.id, doctorId, appointmentId: visit.id }));
    assert.equal(wrongClinic.ok, false);
  });
});
