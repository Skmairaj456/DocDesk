import { z } from "zod";

// Shared by the consultation drawer (client) and the assessment API (server).
// The option values match the Prisma enums MaritalStatus, Comorbidity and Habit.

export const MARITAL_STATUSES = [
  { value: "MARRIED", label: "Married" },
  { value: "UNMARRIED", label: "Unmarried" },
] as const;

export const COMORBIDITIES = [
  { value: "HTN", label: "HTN", hint: "Hypertension" },
  { value: "DM", label: "DM", hint: "Diabetes mellitus" },
  { value: "THYROID", label: "Thyroid", hint: "Thyroid disorder" },
  { value: "CVA", label: "CVA", hint: "Cerebrovascular accident" },
  { value: "CHD", label: "CHD", hint: "Coronary heart disease" },
  { value: "ASTHMA", label: "Asthma", hint: "Asthma" },
  { value: "SEIZURES", label: "Seizures", hint: "Seizures" },
  { value: "OTHER", label: "Any others", hint: "Other comorbidity" },
] as const;

export const HABITS = [
  { value: "ALCOHOL", label: "Alcohol" },
  { value: "SMOKING", label: "Smoking" },
  { value: "OTHER", label: "Any others" },
] as const;

export type MaritalStatusValue = (typeof MARITAL_STATUSES)[number]["value"];
export type ComorbidityValue = (typeof COMORBIDITIES)[number]["value"];
export type HabitValue = (typeof HABITS)[number]["value"];

// Plausible clinical ranges; values outside these are almost certainly typing mistakes.
export const VITAL_LIMITS = {
  bpSystolic: { min: 50, max: 300, unit: "mmHg" },
  bpDiastolic: { min: 20, max: 200, unit: "mmHg" },
  pulseRate: { min: 20, max: 250, unit: "bpm" },
  spo2: { min: 50, max: 100, unit: "%" },
  weightKg: { min: 0.5, max: 500, unit: "kg" },
  heightCm: { min: 20, max: 250, unit: "cm" },
} as const;

export const TEXT_LIMIT = 5000;

const text = z
  .string()
  .max(TEXT_LIMIT, `Keep each entry under ${TEXT_LIMIT} characters.`)
  .nullable()
  .transform((value) => value?.trim() || null);

function whole(field: keyof typeof VITAL_LIMITS, label: string) {
  const { min, max, unit } = VITAL_LIMITS[field];
  return z.number().int(`${label} must be a whole number.`).min(min, `${label} must be at least ${min} ${unit}.`).max(max, `${label} must be at most ${max} ${unit}.`).nullable();
}

function decimal(field: keyof typeof VITAL_LIMITS, label: string) {
  const { min, max, unit } = VITAL_LIMITS[field];
  return z
    .number()
    .min(min, `${label} must be at least ${min} ${unit}.`)
    .max(max, `${label} must be at most ${max} ${unit}.`)
    .nullable()
    .transform((value) => (value === null ? null : Math.round(value * 10) / 10));
}

export const clinicalAssessmentSchema = z
  .object({
    bpSystolic: whole("bpSystolic", "Systolic BP"),
    bpDiastolic: whole("bpDiastolic", "Diastolic BP"),
    pulseRate: whole("pulseRate", "Pulse rate"),
    spo2: whole("spo2", "SpO₂"),
    weightKg: decimal("weightKg", "Weight"),
    heightCm: decimal("heightCm", "Height"),
    maritalStatus: z.enum(["MARRIED", "UNMARRIED"]).nullable(),
    chiefComplaints: text,
    medicalHistory: text,
    surgicalHistory: text,
    comorbidities: z.array(z.enum(["HTN", "DM", "THYROID", "CVA", "CHD", "ASTHMA", "SEIZURES", "OTHER"])).max(8),
    comorbidityOther: text,
    habits: z.array(z.enum(["ALCOHOL", "SMOKING", "OTHER"])).max(3),
    habitDetails: text,
    drugAllergy: z.boolean().nullable(),
    drugAllergyDetails: text,
    investigationsAdded: text,
    investigationsReview: text,
    provisionalDiagnosis: text,
    treatment: text,
    reviewNotes: text,
    advice: text,
    discussed: text,
  })
  .superRefine((value, context) => {
    if ((value.bpSystolic === null) !== (value.bpDiastolic === null)) {
      context.addIssue({ code: "custom", path: ["bpDiastolic"], message: "Enter both systolic and diastolic BP, or leave both empty." });
    } else if (value.bpSystolic !== null && value.bpDiastolic !== null && value.bpSystolic <= value.bpDiastolic) {
      context.addIssue({ code: "custom", path: ["bpSystolic"], message: "Systolic BP must be higher than diastolic BP." });
    }
    if (value.comorbidities.includes("OTHER") && !value.comorbidityOther) {
      context.addIssue({ code: "custom", path: ["comorbidityOther"], message: "Describe the other comorbidity." });
    }
    if (value.habits.includes("OTHER") && !value.habitDetails) {
      context.addIssue({ code: "custom", path: ["habitDetails"], message: "Describe the other habit." });
    }
    if (value.drugAllergy === true && !value.drugAllergyDetails) {
      context.addIssue({ code: "custom", path: ["drugAllergyDetails"], message: "Specify the drug allergy and reaction." });
    }
  })
  // Details that belong to an unselected option are dropped, so stale text is never stored.
  .transform((value) => ({
    ...value,
    comorbidities: [...new Set(value.comorbidities)],
    habits: [...new Set(value.habits)],
    comorbidityOther: value.comorbidities.includes("OTHER") ? value.comorbidityOther : null,
    habitDetails: value.habits.length > 0 ? value.habitDetails : null,
    drugAllergyDetails: value.drugAllergy === true ? value.drugAllergyDetails : null,
  }));

export type ClinicalAssessmentInput = z.input<typeof clinicalAssessmentSchema>;
export type ClinicalAssessmentValues = z.output<typeof clinicalAssessmentSchema>;

// What the API returns: the stored values plus record metadata.
export type ClinicalAssessmentRecord = ClinicalAssessmentValues & { id: string; createdAt: string; updatedAt: string };

export const saveAssessmentRequestSchema = z.object({
  assessment: clinicalAssessmentSchema,
  // The updatedAt the doctor loaded (null for a new assessment). A mismatch means someone else saved in between.
  expectedUpdatedAt: z.string().datetime({ offset: true }).nullable(),
});

export function emptyAssessment(): ClinicalAssessmentValues {
  return {
    bpSystolic: null,
    bpDiastolic: null,
    pulseRate: null,
    spo2: null,
    weightKg: null,
    heightCm: null,
    maritalStatus: null,
    chiefComplaints: null,
    medicalHistory: null,
    surgicalHistory: null,
    comorbidities: [],
    comorbidityOther: null,
    habits: [],
    habitDetails: null,
    drugAllergy: null,
    drugAllergyDetails: null,
    investigationsAdded: null,
    investigationsReview: null,
    provisionalDiagnosis: null,
    treatment: null,
    reviewNotes: null,
    advice: null,
    discussed: null,
  };
}

export function firstIssue(error: z.ZodError) {
  return error.issues[0]?.message ?? "Check the assessment details.";
}
