"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  COMORBIDITIES,
  HABITS,
  MARITAL_STATUSES,
  TEXT_LIMIT,
  VITAL_LIMITS,
  clinicalAssessmentSchema,
  emptyAssessment,
  firstIssue,
  type ClinicalAssessmentRecord,
  type ClinicalAssessmentValues,
  type ComorbidityValue,
  type HabitValue,
} from "@/lib/clinical-assessment";

type VitalKey = keyof typeof VITAL_LIMITS;
type TextKey =
  | "chiefComplaints" | "medicalHistory" | "surgicalHistory" | "comorbidityOther" | "habitDetails" | "drugAllergyDetails"
  | "investigationsAdded" | "investigationsReview" | "provisionalDiagnosis" | "treatment" | "reviewNotes" | "advice" | "discussed";

// Inputs hold text; numbers are parsed only when saving.
type FormState = Omit<ClinicalAssessmentValues, VitalKey | TextKey> & Record<VitalKey, string> & Record<TextKey, string>;

const VITAL_KEYS: VitalKey[] = ["bpSystolic", "bpDiastolic", "pulseRate", "spo2", "weightKg", "heightCm"];
const TEXT_KEYS: TextKey[] = [
  "chiefComplaints", "medicalHistory", "surgicalHistory", "comorbidityOther", "habitDetails", "drugAllergyDetails",
  "investigationsAdded", "investigationsReview", "provisionalDiagnosis", "treatment", "reviewNotes", "advice", "discussed",
];

function toForm(values: ClinicalAssessmentValues): FormState {
  const form = { ...values } as unknown as FormState;
  for (const key of VITAL_KEYS) form[key] = values[key] === null ? "" : String(values[key]);
  for (const key of TEXT_KEYS) form[key] = values[key] ?? "";
  return form;
}

function toPayload(form: FormState) {
  const payload: Record<string, unknown> = { ...form };
  for (const key of VITAL_KEYS) payload[key] = form[key].trim() === "" ? null : Number(form[key]);
  for (const key of TEXT_KEYS) payload[key] = form[key];
  return payload;
}

function filled(form: FormState, keys: (keyof FormState)[]) {
  return keys.filter((key) => {
    const value = form[key];
    return Array.isArray(value) ? value.length > 0 : value !== null && value !== "";
  }).length;
}

function savedTime(iso: string) {
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", day: "numeric", month: "short" }).format(new Date(iso));
}

const SECTIONS: { id: string; title: string; keys: (keyof FormState)[] }[] = [
  { id: "vitals", title: "Vitals", keys: ["bpSystolic", "pulseRate", "spo2", "weightKg", "heightCm"] },
  { id: "history", title: "History & complaints", keys: ["maritalStatus", "chiefComplaints", "medicalHistory", "surgicalHistory"] },
  { id: "risk", title: "Comorbidities, habits & allergies", keys: ["comorbidities", "habits", "drugAllergy"] },
  { id: "investigations", title: "Investigations", keys: ["investigationsAdded", "investigationsReview"] },
  { id: "plan", title: "Diagnosis & plan", keys: ["provisionalDiagnosis", "treatment", "reviewNotes", "advice", "discussed"] },
];

export default function ClinicalAssessment({ appointmentId }: { appointmentId: string }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [editable, setEditable] = useState(false);
  const [record, setRecord] = useState<ClinicalAssessmentRecord | null>(null);
  const [form, setForm] = useState<FormState>(() => toForm(emptyAssessment()));
  const [baseline, setBaseline] = useState(() => JSON.stringify(toForm(emptyAssessment())));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/appointments/${appointmentId}/assessment`);
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Unable to load the clinical assessment.");
        if (cancelled) return;
        const next = toForm(result.assessment ?? emptyAssessment());
        setRecord(result.assessment);
        setEditable(result.editable);
        setForm(next);
        setBaseline(JSON.stringify(next));
      } catch (caught) {
        if (!cancelled) setLoadError(caught instanceof Error ? caught.message : "Unable to load the clinical assessment.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [appointmentId]);

  const dirty = useMemo(() => JSON.stringify(form) !== baseline, [form, baseline]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }

  function toggle<K extends "comorbidities" | "habits">(key: K, value: K extends "comorbidities" ? ComorbidityValue : HabitValue) {
    const list = form[key] as string[];
    set(key, (list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]) as FormState[K]);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const checked = clinicalAssessmentSchema.safeParse(toPayload(form));
    if (!checked.success) {
      setError(firstIssue(checked.error));
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`/api/appointments/${appointmentId}/assessment`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assessment: toPayload(form), expectedUpdatedAt: record?.updatedAt ?? null }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to save the clinical assessment.");
      const next = toForm(result.assessment);
      setRecord(result.assessment);
      setForm(next);
      setBaseline(JSON.stringify(next));
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save the clinical assessment.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <section className="assessment" aria-busy="true"><p className="assessment-state">Loading clinical assessment…</p></section>;
  if (loadError) return <section className="assessment"><p className="assessment-error" role="alert">{loadError}</p></section>;
  if (!editable && !record) {
    return <section className="assessment"><h3>Clinical assessment</h3><p className="doctor-locked-note">No clinical assessment was recorded for this visit.</p></section>;
  }

  const readOnly = !editable;
  const textArea = (key: TextKey, label: string, placeholder: string, rows = 3) => (
    <label className="assessment-field assessment-wide">
      {label}
      <textarea rows={rows} maxLength={TEXT_LIMIT} disabled={readOnly} value={form[key]} placeholder={readOnly ? "" : placeholder} onChange={(event) => set(key, event.target.value)} />
    </label>
  );
  const vital = (key: VitalKey, label: string, hint: string, step = 1) => (
    <label className="assessment-field">
      <span><abbr title={hint}>{label}</abbr> <small>{hint}</small></span>
      <span className="assessment-unit">
        <input type="number" inputMode={step < 1 ? "decimal" : "numeric"} step={step} min={VITAL_LIMITS[key].min} max={VITAL_LIMITS[key].max} disabled={readOnly} value={form[key]} onChange={(event) => set(key, event.target.value)} />
        <em>{VITAL_LIMITS[key].unit}</em>
      </span>
    </label>
  );

  return (
    <form className="assessment" onSubmit={save} noValidate>
      <header className="assessment-header">
        <div><h3>Clinical assessment</h3><p>Vitals, history and plan for this visit.</p></div>
        {record && <small>Last saved {savedTime(record.updatedAt)}</small>}
      </header>

      {SECTIONS.map((section, index) => {
        const count = filled(form, section.keys);
        return (
          <details key={section.id} className="assessment-section" open={index < 2 || (readOnly && count > 0)}>
            <summary><span>{section.title}</span><small>{count > 0 ? `${count} recorded` : "Not recorded"}</small></summary>
            <div className="assessment-grid">
              {section.id === "vitals" && <>
                <fieldset className="assessment-field assessment-bp" disabled={readOnly}>
                  <legend><abbr title="Blood pressure">BP</abbr> <small>Blood pressure</small></legend>
                  <span className="assessment-unit">
                    <input aria-label="Systolic BP" placeholder="Sys" type="number" inputMode="numeric" min={VITAL_LIMITS.bpSystolic.min} max={VITAL_LIMITS.bpSystolic.max} value={form.bpSystolic} onChange={(event) => set("bpSystolic", event.target.value)} />
                    <b>/</b>
                    <input aria-label="Diastolic BP" placeholder="Dia" type="number" inputMode="numeric" min={VITAL_LIMITS.bpDiastolic.min} max={VITAL_LIMITS.bpDiastolic.max} value={form.bpDiastolic} onChange={(event) => set("bpDiastolic", event.target.value)} />
                    <em>mmHg</em>
                  </span>
                </fieldset>
                {vital("pulseRate", "PR", "Pulse rate")}
                {vital("spo2", "SpO₂", "Oxygen saturation")}
                {vital("weightKg", "WT", "Weight", 0.1)}
                {vital("heightCm", "HT", "Height", 0.1)}
              </>}

              {section.id === "history" && <>
                <label className="assessment-field">
                  Marital status
                  <select disabled={readOnly} value={form.maritalStatus ?? ""} onChange={(event) => set("maritalStatus", (event.target.value || null) as FormState["maritalStatus"])}>
                    <option value="">Not recorded</option>
                    {MARITAL_STATUSES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                {textArea("chiefComplaints", "C/O · Chief complaints", "Complaints of… onset, duration, severity", 4)}
                <p className="assessment-subhead assessment-wide">Previous hospital history</p>
                {textArea("medicalHistory", "Medical history", "Previous illnesses, admissions, ongoing medication")}
                {textArea("surgicalHistory", "Surgical history", "Previous surgeries and procedures, with year")}
              </>}

              {section.id === "risk" && <>
                <fieldset className="assessment-field assessment-wide" disabled={readOnly}>
                  <legend>Comorbidities</legend>
                  <div className="assessment-chips">
                    {COMORBIDITIES.map((option) => (
                      <label key={option.value} className={form.comorbidities.includes(option.value) ? "selected" : ""} title={option.hint}>
                        <input type="checkbox" checked={form.comorbidities.includes(option.value)} onChange={() => toggle("comorbidities", option.value)} />
                        {option.label}{option.label !== option.hint && option.value !== "OTHER" && <small>{option.hint}</small>}
                      </label>
                    ))}
                  </div>
                </fieldset>
                {form.comorbidities.includes("OTHER") && (
                  <label className="assessment-field assessment-wide">
                    Other comorbidities <small>Required</small>
                    <input maxLength={TEXT_LIMIT} disabled={readOnly} value={form.comorbidityOther} onChange={(event) => set("comorbidityOther", event.target.value)} placeholder="Describe the other comorbidity" />
                  </label>
                )}

                <fieldset className="assessment-field assessment-wide" disabled={readOnly}>
                  <legend>Habits</legend>
                  <div className="assessment-chips">
                    {HABITS.map((option) => (
                      <label key={option.value} className={form.habits.includes(option.value) ? "selected" : ""}>
                        <input type="checkbox" checked={form.habits.includes(option.value)} onChange={() => toggle("habits", option.value)} />
                        {option.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
                {form.habits.length > 0 && (
                  <label className="assessment-field assessment-wide">
                    Habit details {form.habits.includes("OTHER") ? <small>Required for “Any others”</small> : <small>Optional</small>}
                    <input maxLength={TEXT_LIMIT} disabled={readOnly} value={form.habitDetails} onChange={(event) => set("habitDetails", event.target.value)} placeholder="Quantity, frequency, duration, other habits" />
                  </label>
                )}

                <fieldset className="assessment-field assessment-wide" disabled={readOnly}>
                  <legend>Drug allergies</legend>
                  <div className="assessment-chips">
                    {([[true, "Yes"], [false, "No"]] as const).map(([value, label]) => (
                      <label key={label} className={form.drugAllergy === value ? "selected" : ""}>
                        <input type="radio" name={`drug-allergy-${appointmentId}`} checked={form.drugAllergy === value} onChange={() => set("drugAllergy", value)} />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>
                {form.drugAllergy === true && textArea("drugAllergyDetails", "Allergy details · Required", "Drug name and reaction, e.g. Penicillin – rash", 2)}
              </>}

              {section.id === "investigations" && <>
                {textArea("investigationsAdded", "Add investigations", "Tests ordered for this visit, e.g. CBC, LFT, X-ray chest PA view")}
                {textArea("investigationsReview", "Review investigations", "Results and findings of investigations reviewed")}
              </>}

              {section.id === "plan" && <>
                {textArea("provisionalDiagnosis", "Provisional diagnosis", "Working diagnosis for this visit")}
                {textArea("treatment", "Treatment", "Medication with dose, frequency and duration; procedures", 4)}
                {textArea("reviewNotes", "Review", "When and why to review, e.g. Review after 1 week with reports")}
                {textArea("advice", "Precautions / advice", "Diet, activity, warning signs and other advice for the patient")}
                {textArea("discussed", "Discussed", "What was discussed with the patient or family")}
              </>}
            </div>
          </details>
        );
      })}

      {error && <p className="assessment-error" role="alert">{error}</p>}
      {editable ? (
        <div className="doctor-consultation-actions">
          <span role="status">{saving ? "Saving…" : dirty ? "Unsaved changes" : saved ? "Assessment saved." : record ? "All changes saved." : "Nothing saved yet."}</span>
          <button type="submit" className="button button-primary" disabled={saving || !dirty}>{saving ? "Saving…" : record ? "Update assessment" : "Save assessment"}</button>
        </div>
      ) : (
        <p className="doctor-locked-note">This visit is completed. Its clinical assessment is preserved and read-only.</p>
      )}
    </form>
  );
}
