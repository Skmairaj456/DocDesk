"use client";

import { FormEvent, useEffect, useState } from "react";

type Visit = {
  id: string;
  reference: string;
  startsAt: string;
  status: string;
  visitType: string;
  source: "RECEPTION" | "DOCTOR" | "WHATSAPP";
  department: { name: string };
  doctor: { membership: { user: { displayName: string } } };
};
export type PatientProfileData = {
  id: string;
  fullName: string;
  phone: string;
  dateOfBirth: string | null;
  sex: string | null;
  registrationStatus: "INCOMPLETE" | "COMPLETE";
  createdAt: string;
  appointments: Visit[];
};

const sexLabels: Record<string, string> = { FEMALE: "Female", MALE: "Male", OTHER: "Other", NOT_SPECIFIED: "Not specified" };
const sourceLabels: Record<Visit["source"], string> = { WHATSAPP: "WhatsApp", RECEPTION: "Reception", DOCTOR: "Doctor" };

function statusLabel(status: string) {
  return status.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function age(dateOfBirth: string | null) {
  if (!dateOfBirth) return null;
  const birth = new Date(dateOfBirth);
  const now = new Date();
  let years = now.getUTCFullYear() - birth.getUTCFullYear();
  if (now.getUTCMonth() < birth.getUTCMonth() || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())) years -= 1;
  return years;
}

export default function PatientProfile({
  patientId,
  timezone,
  onClose,
  onBook,
  onUpdated,
}: {
  patientId: string;
  timezone: string;
  onClose: () => void;
  onBook: (patient: PatientProfileData) => void;
  onUpdated: (patient: PatientProfileData) => void;
}) {
  const [patient, setPatient] = useState<PatientProfileData | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [sex, setSex] = useState("");
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    fetch(`/api/patients/${patientId}`)
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Unable to load the patient profile.");
        if (active) setPatient(result.patient);
      })
      .catch((caught: unknown) => active && setError(caught instanceof Error ? caught.message : "Unable to load the patient profile."));
    return () => {
      active = false;
    };
  }, [patientId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function startEditing() {
    if (!patient) return;
    setFullName(patient.fullName);
    setPhone(patient.phone);
    setDateOfBirth(patient.dateOfBirth?.slice(0, 10) ?? "");
    setSex(patient.sex ?? "");
    setError("");
    setEditing(true);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/patients/${patientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, phone, dateOfBirth: dateOfBirth || null, sex: sex || null }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to update the patient.");
      setPatient(result.patient);
      onUpdated(result.patient);
      setEditing(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update the patient.");
    } finally {
      setSaving(false);
    }
  }

  const fullDate = new Intl.DateTimeFormat("en", { timeZone: timezone, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
  const upcoming = patient?.appointments
    .filter((visit) => new Date(visit.startsAt).valueOf() >= now && visit.status !== "CANCELLED")
    .reverse() ?? [];
  const history = patient?.appointments.filter((visit) => !upcoming.includes(visit)) ?? [];
  const years = age(patient?.dateOfBirth ?? null);

  function visitRow(visit: Visit) {
    return (
      <article key={visit.id} className="profile-visit">
        <div>
          <strong>{fullDate.format(new Date(visit.startsAt))}</strong>
          <small>{visit.doctor.membership.user.displayName} · {visit.department.name} · {visit.visitType.replaceAll("_", " ").toLowerCase()}</small>
        </div>
        <span className={`recent-booking-source ${visit.source.toLowerCase()}`}>{sourceLabels[visit.source]}</span>
        <span className={`live-status ${visit.status.toLowerCase().replaceAll("_", "-")}`}>{statusLabel(visit.status)}</span>
      </article>
    );
  }

  return (
    <div className="doctor-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="doctor-drawer" role="dialog" aria-modal="true" aria-labelledby="patient-profile-title">
        <header className="doctor-drawer-header">
          <div>
            <p className="eyebrow">PATIENT PROFILE</p>
            <h2 id="patient-profile-title">{patient?.fullName ?? "Loading…"}</h2>
            {patient && <span>{years !== null ? `${years} years` : "Age not recorded"} · {patient.sex ? sexLabels[patient.sex] ?? patient.sex : "Sex not recorded"} · {patient.phone}</span>}
          </div>
          <button className="button button-quiet" onClick={onClose}>Close</button>
        </header>
        <div className="doctor-drawer-content">
          {error && <p className="live-error" role="alert">{error}</p>}
          {patient && (
            <>
              <div className="profile-actions">
                <button className="button button-primary" onClick={() => onBook(patient)}>Book appointment</button>
                {!editing && <button className="button button-outline" onClick={startEditing}>Edit details</button>}
                <span>{patient.appointments.length} visits · {upcoming.length} upcoming</span>
              </div>
              {patient.registrationStatus === "INCOMPLETE" && <p className="doctor-locked-note">Registration incomplete: this patient started on WhatsApp and has not confirmed their details yet.</p>}
              {editing ? (
                <form className="doctor-patient-details profile-edit" onSubmit={save}>
                  <h3>Edit details</h3>
                  <div className="live-form-grid">
                    <label>Full name<input required minLength={2} maxLength={120} value={fullName} onChange={(event) => setFullName(event.target.value)} /></label>
                    <label>Phone<input required inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
                    <label>Date of birth<input type="date" value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} /></label>
                    <label>Sex<select value={sex} onChange={(event) => setSex(event.target.value)}><option value="">Not recorded</option>{Object.entries(sexLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  </div>
                  <div className="live-form-actions">
                    <button type="button" className="button button-quiet" onClick={() => setEditing(false)}>Cancel</button>
                    <button className="button button-primary" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
                  </div>
                </form>
              ) : (
                <section className="doctor-patient-details">
                  <h3>Contact details</h3>
                  <dl>
                    <div><dt>Full name</dt><dd>{patient.fullName}</dd></div>
                    <div><dt>Phone</dt><dd><a href={`tel:${patient.phone}`}>{patient.phone}</a></dd></div>
                    <div><dt>Date of birth</dt><dd>{patient.dateOfBirth ? new Intl.DateTimeFormat("en", { timeZone: "UTC", dateStyle: "long" }).format(new Date(patient.dateOfBirth)) : "Not recorded"}</dd></div>
                    <div><dt>Sex</dt><dd>{patient.sex ? sexLabels[patient.sex] ?? patient.sex : "Not recorded"}</dd></div>
                    <div><dt>Patient since</dt><dd>{new Intl.DateTimeFormat("en", { timeZone: timezone, dateStyle: "medium" }).format(new Date(patient.createdAt))}</dd></div>
                  </dl>
                </section>
              )}
              <section className="doctor-history">
                <h3>Upcoming visits</h3>
                {upcoming.length ? upcoming.map(visitRow) : <p className="profile-empty">No upcoming visits.</p>}
              </section>
              <section className="doctor-history">
                <h3>Visit history</h3>
                {history.length ? history.map(visitRow) : <p className="profile-empty">No past visits.</p>}
              </section>
              <p className="profile-note">Clinical notes are only visible to doctors.</p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
