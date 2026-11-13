import { COMORBIDITIES, HABITS, MARITAL_STATUSES, type ClinicalAssessmentRecord } from "@/lib/clinical-assessment";

// Read-only summary of an earlier visit's clinical assessment, shown in the care history.
// The diagnosis and treatment are always visible; the rest of the assessment folds away.

function labelOf(options: ReadonlyArray<{ value: string; label: string }>, value: string) {
  return options.find((option) => option.value === value)?.label ?? value;
}

function vitalsLine(a: ClinicalAssessmentRecord) {
  const parts = [
    a.bpSystolic !== null && a.bpDiastolic !== null ? `BP ${a.bpSystolic}/${a.bpDiastolic} mmHg` : null,
    a.pulseRate !== null ? `Pulse ${a.pulseRate} bpm` : null,
    a.spo2 !== null ? `SpO₂ ${a.spo2}%` : null,
    a.weightKg !== null ? `Weight ${a.weightKg} kg` : null,
    a.heightCm !== null ? `Height ${a.heightCm} cm` : null,
  ];
  return parts.filter(Boolean).join(" · ") || null;
}

function comorbiditiesLine(a: ClinicalAssessmentRecord) {
  if (a.comorbidities.length === 0) return null;
  return a.comorbidities.map((value) => (value === "OTHER" && a.comorbidityOther ? a.comorbidityOther : labelOf(COMORBIDITIES, value))).join(", ");
}

function habitsLine(a: ClinicalAssessmentRecord) {
  if (a.habits.length === 0) return null;
  const names = a.habits.map((value) => labelOf(HABITS, value)).join(", ");
  return a.habitDetails ? `${names} — ${a.habitDetails}` : names;
}

function allergyLine(a: ClinicalAssessmentRecord) {
  if (a.drugAllergy === null) return null;
  return a.drugAllergy ? `Yes — ${a.drugAllergyDetails ?? "details not recorded"}` : "No known drug allergy";
}

export default function AssessmentSummary({ assessment }: { assessment: ClinicalAssessmentRecord }) {
  const headline: Array<[string, string | null]> = [
    ["Provisional diagnosis", assessment.provisionalDiagnosis],
    ["Treatment", assessment.treatment],
  ];
  const details: Array<[string, string | null]> = [
    ["Vitals", vitalsLine(assessment)],
    ["Chief complaints", assessment.chiefComplaints],
    ["Drug allergy", allergyLine(assessment)],
    ["Comorbidities", comorbiditiesLine(assessment)],
    ["Medical history", assessment.medicalHistory],
    ["Surgical history", assessment.surgicalHistory],
    ["Habits", habitsLine(assessment)],
    ["Marital status", assessment.maritalStatus ? labelOf(MARITAL_STATUSES, assessment.maritalStatus) : null],
    ["Investigations added", assessment.investigationsAdded],
    ["Investigations review", assessment.investigationsReview],
    ["Review notes", assessment.reviewNotes],
    ["Advice", assessment.advice],
    ["Discussed", assessment.discussed],
  ];
  const shownHeadline = headline.filter(([, value]) => value);
  const shownDetails = details.filter(([, value]) => value);
  if (shownHeadline.length === 0 && shownDetails.length === 0) return null;

  return (
    <div className="assessment-summary">
      {shownHeadline.length > 0 && <dl>{shownHeadline.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
      {shownDetails.length > 0 && (
        <details>
          <summary>Full assessment</summary>
          <dl>{shownDetails.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        </details>
      )}
    </div>
  );
}
