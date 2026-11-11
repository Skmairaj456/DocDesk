-- Structured clinical assessment for a visit (vitals, history, comorbidities, habits, allergies,
-- investigations, diagnosis and plan). One per appointment, alongside that visit's Consultation.

CREATE TYPE "MaritalStatus" AS ENUM ('MARRIED', 'UNMARRIED');
CREATE TYPE "Comorbidity" AS ENUM ('HTN', 'DM', 'THYROID', 'CVA', 'CHD', 'ASTHMA', 'SEIZURES', 'OTHER');
CREATE TYPE "Habit" AS ENUM ('ALCOHOL', 'SMOKING', 'OTHER');

CREATE TABLE "ClinicalAssessment" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "appointmentId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "doctorId" UUID NOT NULL,
    "bpSystolic" INTEGER,
    "bpDiastolic" INTEGER,
    "pulseRate" INTEGER,
    "spo2" INTEGER,
    "weightKg" DECIMAL(5,1),
    "heightCm" DECIMAL(5,1),
    "maritalStatus" "MaritalStatus",
    "chiefComplaints" TEXT,
    "medicalHistory" TEXT,
    "surgicalHistory" TEXT,
    "comorbidities" "Comorbidity"[] DEFAULT ARRAY[]::"Comorbidity"[],
    "comorbidityOther" TEXT,
    "habits" "Habit"[] DEFAULT ARRAY[]::"Habit"[],
    "habitDetails" TEXT,
    "drugAllergy" BOOLEAN,
    "drugAllergyDetails" TEXT,
    "investigationsAdded" TEXT,
    "investigationsReview" TEXT,
    "provisionalDiagnosis" TEXT,
    "treatment" TEXT,
    "reviewNotes" TEXT,
    "advice" TEXT,
    "discussed" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClinicalAssessment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClinicalAssessment_appointmentId_key" ON "ClinicalAssessment"("appointmentId");
CREATE INDEX "ClinicalAssessment_clinicId_patientId_createdAt_idx" ON "ClinicalAssessment"("clinicId", "patientId", "createdAt");

ALTER TABLE "ClinicalAssessment" ADD CONSTRAINT "ClinicalAssessment_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClinicalAssessment" ADD CONSTRAINT "ClinicalAssessment_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClinicalAssessment" ADD CONSTRAINT "ClinicalAssessment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClinicalAssessment" ADD CONSTRAINT "ClinicalAssessment_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "DoctorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Same-clinic guarantees, matching Consultation: the appointment, patient and doctor must all belong
-- to the assessment's clinic.
ALTER TABLE "ClinicalAssessment"
  ADD CONSTRAINT "ClinicalAssessment_appointment_tenant_fkey"
  FOREIGN KEY ("clinicId", "appointmentId") REFERENCES "Appointment"("clinicId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ClinicalAssessment_patient_tenant_fkey"
  FOREIGN KEY ("clinicId", "patientId") REFERENCES "Patient"("clinicId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ClinicalAssessment_doctor_tenant_fkey"
  FOREIGN KEY ("clinicId", "doctorId") REFERENCES "DoctorProfile"("clinicId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-level security, matching Consultation.
ALTER TABLE "ClinicalAssessment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClinicalAssessment" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ClinicalAssessment_tenant_policy" ON "ClinicalAssessment"
  USING ("clinicId"::text = current_setting('app.clinic_id', true) OR current_setting('app.worker', true) = 'true')
  WITH CHECK ("clinicId"::text = current_setting('app.clinic_id', true) OR current_setting('app.worker', true) = 'true');
