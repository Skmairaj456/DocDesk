"use client";

import type { AppointmentStatus as AppointmentStatusType, ClinicRole as ClinicRoleType } from "@prisma/client";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { localDateTimeAsUtc } from "@/lib/booking-time.mjs";
import InboxPanel from "@/components/inbox-panel";
import RecentBookings, { bookingDay } from "@/components/recent-bookings";

const AppointmentStatus = {
  BOOKED: "BOOKED",
  ARRIVED: "ARRIVED",
  IN_CONSULTATION: "IN_CONSULTATION",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
} as const;
const ClinicRole = { DOCTOR: "DOCTOR" } as const;

type Patient = { id: string; fullName: string; phone: string; dateOfBirth: string | null };
type Department = { id: string; name: string };
type Doctor = { id: string; name: string; consultationMinutes: number; departmentIds: string[] };
type Appointment = {
  id: string;
  reference: string;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatusType;
  visitType: string;
  patient: { id: string; fullName: string };
  doctor: { membership: { user: { displayName: string } } };
  department: { name: string };
};

export type LiveWorkspaceData = {
  clinicName: string;
  timezone: string;
  role: ClinicRoleType;
  appointments: Appointment[];
  patients: Patient[];
  departments: Department[];
  doctors: Doctor[];
  localDate: string;
};

function formatAppointmentTime(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function formatAppointmentDate(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(iso));
}

function appointmentStatusLabel(status: AppointmentStatusType) {
  return status.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function LiveClinicWorkspace(initialData: LiveWorkspaceData) {
  const [appointments, setAppointments] = useState(initialData.appointments);
  const [patients, setPatients] = useState(initialData.patients);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"appointments" | "patients" | "whatsapp">("appointments");
  const [selectedDate, setSelectedDate] = useState(initialData.localDate);
  const [statusFilter, setStatusFilter] = useState<"all" | AppointmentStatusType>("all");
  const [doctorFilter, setDoctorFilter] = useState("all");
  const [apptSearch, setApptSearch] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [showPatientForm, setShowPatientForm] = useState(false);
  const [showBookingForm, setShowBookingForm] = useState(false);
  const [patientName, setPatientName] = useState("");
  const [patientPhone, setPatientPhone] = useState("");
  const [patientDateOfBirth, setPatientDateOfBirth] = useState("");
  const [selectedPatient, setSelectedPatient] = useState(initialData.patients[0]?.id ?? "");
  const [selectedDepartment, setSelectedDepartment] = useState(initialData.departments[0]?.id ?? "");
  const [selectedDoctor, setSelectedDoctor] = useState(initialData.doctors[0]?.id ?? "");
  const [visitDate, setVisitDate] = useState(initialData.localDate);
  const [visitTime, setVisitTime] = useState("12:00");
  const [visitType, setVisitType] = useState("CONSULTATION");

  const visiblePatients = useMemo(() => {
    const term = search.toLocaleLowerCase().trim();
    return patients.filter((patient) => `${patient.fullName} ${patient.phone}`.toLocaleLowerCase().includes(term));
  }, [patients, search]);
  const counts = useMemo(() => {
    const live = appointments.filter((entry) => entry.status !== AppointmentStatus.CANCELLED);
    return {
      total: live.length,
      waiting: live.filter((entry) => entry.status === AppointmentStatus.ARRIVED).length,
      inConsultation: live.filter((entry) => entry.status === AppointmentStatus.IN_CONSULTATION).length,
      completed: live.filter((entry) => entry.status === AppointmentStatus.COMPLETED).length,
      booked: live.filter((entry) => entry.status === AppointmentStatus.BOOKED).length,
      cancelled: appointments.length - live.length,
    };
  }, [appointments]);
  const visibleAppointments = useMemo(() => {
    const term = apptSearch.trim().toLocaleLowerCase();
    return appointments.filter((entry) =>
      (statusFilter === "all" || entry.status === statusFilter) &&
      (doctorFilter === "all" || entry.doctor.membership.user.displayName === doctorFilter) &&
      (!term || `${entry.patient.fullName} ${entry.reference}`.toLocaleLowerCase().includes(term)),
    );
  }, [appointments, statusFilter, doctorFilter, apptSearch]);
  const availableDoctors = initialData.doctors.filter((doctor) => doctor.departmentIds.includes(selectedDepartment));
  const selectedDoctorInfo = availableDoctors.find((doctor) => doctor.id === selectedDoctor);

  function showMessage(text: string) {
    setMessage(text);
    window.setTimeout(() => setMessage(""), 4000);
  }

  async function submitPatient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/patients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: patientName,
          phone: patientPhone,
          ...(patientDateOfBirth ? { dateOfBirth: patientDateOfBirth } : {}),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to register patient.");
      setPatients((current) => [result.patient, ...current]);
      setSelectedPatient(result.patient.id);
      setShowPatientForm(false);
      setPatientName("");
      setPatientPhone("");
      setPatientDateOfBirth("");
      showMessage("Patient record created.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to register patient.");
    } finally {
      setSaving(false);
    }
  }

  async function refreshAppointments(date: string) {
    const response = await fetch(`/api/appointments?date=${encodeURIComponent(date)}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Unable to refresh appointments.");
    setAppointments(result.appointments);
    setSelectedDate(date);
  }

  // WhatsApp bookings arrive without any action on this screen, so keep the visible day current.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshAppointments(selectedDate).catch(() => undefined);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [selectedDate]);

  function shiftDay(days: number) {
    const next = new Date(`${selectedDate}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + days);
    refreshAppointments(next.toISOString().slice(0, 10)).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Unable to load the schedule."));
  }

  async function cancelAppointment(appointment: Appointment) {
    if (!window.confirm(`Cancel ${appointment.patient.fullName}'s appointment (${appointment.reference})? The slot will be released.`)) return;
    await updateAppointment(appointment, AppointmentStatus.CANCELLED);
  }

  async function submitAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDoctorInfo) {
      setError("Choose a doctor who is assigned to this department.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const startsAt = localDateTimeAsUtc(visitDate, visitTime, initialData.timezone);
      const endsAt = new Date(startsAt.valueOf() + selectedDoctorInfo.consultationMinutes * 60_000);
      const response = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId: selectedPatient,
          departmentId: selectedDepartment,
          doctorId: selectedDoctor,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          visitType,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to book appointment.");
      await refreshAppointments(visitDate);
      setShowBookingForm(false);
      showMessage(`Appointment booked · ${result.appointment.reference}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to book appointment.");
    } finally {
      setSaving(false);
    }
  }

  async function updateAppointment(appointment: Appointment, status: AppointmentStatusType) {
    setError("");
    try {
      const response = await fetch(`/api/appointments/${appointment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to update appointment.");
      setAppointments((current) => current.map((entry) => entry.id === appointment.id ? { ...entry, status: result.appointment.status } : entry));
      showMessage(`Visit updated · ${appointment.patient.fullName}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update appointment.");
    }
  }

  function nextAction(appointment: Appointment): { label: string; status: AppointmentStatusType } | null {
    if (initialData.role === ClinicRole.DOCTOR) {
      if (appointment.status === AppointmentStatus.ARRIVED) {
        return { label: "Start visit", status: AppointmentStatus.IN_CONSULTATION };
      }
      if (appointment.status === AppointmentStatus.IN_CONSULTATION) {
        return { label: "Complete visit", status: AppointmentStatus.COMPLETED };
      }
      return null;
    }
    if (appointment.status === AppointmentStatus.BOOKED) {
      return { label: "Check in", status: AppointmentStatus.ARRIVED };
    }
    return null;
  }

  return (
    <main className="live-workspace">
      <header className="live-header">
        <div className="live-brand"><span className="brand-mark">d.</span><span><strong>docdesk</strong><small>{initialData.clinicName}</small></span></div>
        <div className="live-account"><span className="live-secure">Secure clinic records</span><span className="live-role">{initialData.role.toLowerCase()}</span><form action="/auth/sign-out" method="post"><button className="button button-quiet" type="submit">Sign out</button></form></div>
      </header>
      <div className="live-body">
        <div className="live-title">
          <div><p className="eyebrow">{formatAppointmentDate(`${initialData.localDate}T12:00:00`, initialData.timezone).toUpperCase()}</p><h1>Clinic workspace</h1><p>Authenticated data · {initialData.timezone}</p></div>
          <div className="heading-actions">
            {initialData.role !== ClinicRole.DOCTOR && <button className="button button-outline" onClick={() => { setError(""); setShowPatientForm((value) => !value); setShowBookingForm(false); }}>Register patient</button>}
            {initialData.role !== ClinicRole.DOCTOR && <button className="button button-primary" onClick={() => { setError(""); setShowBookingForm((value) => !value); setShowPatientForm(false); }}>New appointment</button>}
          </div>
        </div>
        {error && <p className="live-error" role="alert">{error}</p>}
        {message && <p className="live-message" role="status">{message}</p>}
        {showPatientForm && <form className="live-form" onSubmit={submitPatient}><h2>Register patient</h2><div className="live-form-grid"><label>Full name<input required minLength={2} value={patientName} onChange={(event) => setPatientName(event.target.value)} /></label><label>Phone<input required inputMode="tel" value={patientPhone} onChange={(event) => setPatientPhone(event.target.value)} /></label><label>Date of birth (optional)<input type="date" value={patientDateOfBirth} onChange={(event) => setPatientDateOfBirth(event.target.value)} /></label></div><div className="live-form-actions"><button className="button button-quiet" type="button" onClick={() => setShowPatientForm(false)}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Saving…" : "Create patient"}</button></div></form>}
        {showBookingForm && <form className="live-form" onSubmit={submitAppointment}><h2>Book appointment</h2><div className="live-form-grid live-booking-grid">
          <label>Patient<select required value={selectedPatient} onChange={(event) => setSelectedPatient(event.target.value)}>{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.fullName} · {patient.phone}</option>)}</select></label>
          <label>Department<select required value={selectedDepartment} onChange={(event) => { const departmentId = event.target.value; setSelectedDepartment(departmentId); setSelectedDoctor(initialData.doctors.find((doctor) => doctor.departmentIds.includes(departmentId))?.id ?? ""); }}>{initialData.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
          <label>Doctor<select required value={selectedDoctor} onChange={(event) => setSelectedDoctor(event.target.value)}>{availableDoctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}</option>)}</select></label>
          <label>Date<input required type="date" min={initialData.localDate} value={visitDate} onChange={(event) => setVisitDate(event.target.value)} /></label>
          <label>Time<input required type="time" value={visitTime} onChange={(event) => setVisitTime(event.target.value)} /></label>
          <label>Visit type<select value={visitType} onChange={(event) => setVisitType(event.target.value)}><option value="CONSULTATION">Consultation</option><option value="FOLLOW_UP">Follow-up</option><option value="REVISION">Revision</option><option value="WALK_IN">Walk-in</option></select></label>
        </div><p className="live-form-help">Availability and competing reservations are checked on the server. If another staff member books this time first, choose a different slot.</p><div className="live-form-actions"><button className="button button-quiet" type="button" onClick={() => setShowBookingForm(false)}>Cancel</button><button className="button button-primary" disabled={saving || !patients.length || !availableDoctors.length}>{saving ? "Booking…" : "Confirm appointment"}</button></div></form>}
        <div className="reception-metrics" aria-label="Day summary">
          <article className="metric-blue"><span>Visits</span><strong>{counts.total}</strong><small>{counts.booked} yet to arrive</small></article>
          <article className="metric-amber"><span>Waiting</span><strong>{counts.waiting}</strong><small>Checked in</small></article>
          <article className="metric-purple"><span>In consultation</span><strong>{counts.inConsultation}</strong><small>With a doctor</small></article>
          <article className="metric-green"><span>Completed</span><strong>{counts.completed}</strong><small>Visits done</small></article>
          <article className="metric-slate"><span>Cancelled</span><strong>{counts.cancelled}</strong><small>Slots released</small></article>
        </div>
        <RecentBookings
          timezone={initialData.timezone}
          showDoctor
          onOpen={(booking) => {
            setView("appointments");
            setStatusFilter("all");
            setDoctorFilter("all");
            setApptSearch(booking.reference);
            refreshAppointments(bookingDay(booking.startsAt, initialData.timezone)).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Unable to load the schedule."));
          }}
        />
        <div className="live-tabs" role="tablist" aria-label="Clinic sections"><button role="tab" aria-selected={view === "appointments"} className={view === "appointments" ? "selected" : ""} onClick={() => setView("appointments")}>Appointments <span>{appointments.length}</span></button><button role="tab" aria-selected={view === "patients"} className={view === "patients" ? "selected" : ""} onClick={() => setView("patients")}>Patients <span>{patients.length}</span></button><button role="tab" aria-selected={view === "whatsapp"} className={view === "whatsapp" ? "selected" : ""} onClick={() => setView("whatsapp")}>WhatsApp</button></div>
        {view === "appointments" && <section className="live-panel"><div className="live-panel-heading"><div><h2>{selectedDate === initialData.localDate ? "Today’s appointments" : "Appointments"}</h2><p>{formatAppointmentDate(`${selectedDate}T12:00:00`, initialData.timezone)} · {appointments.length} visits</p></div><div className="reception-day-nav"><button type="button" aria-label="Previous day" onClick={() => shiftDay(-1)}>‹</button><button type="button" disabled={selectedDate === initialData.localDate} onClick={() => refreshAppointments(initialData.localDate).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Unable to load the schedule."))}>Today</button><button type="button" aria-label="Next day" onClick={() => shiftDay(1)}>›</button><label className="live-search"><input type="date" aria-label="Schedule date" value={selectedDate} onChange={(event) => event.target.value && refreshAppointments(event.target.value).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Unable to load the schedule."))} /></label></div></div>
          <div className="reception-filters"><div className="reception-chips" role="group" aria-label="Filter by status">{([["all", "All"], [AppointmentStatus.BOOKED, "Booked"], [AppointmentStatus.ARRIVED, "Waiting"], [AppointmentStatus.IN_CONSULTATION, "In consultation"], [AppointmentStatus.COMPLETED, "Completed"], [AppointmentStatus.CANCELLED, "Cancelled"]] as const).map(([value, label]) => <button key={value} type="button" className={statusFilter === value ? "selected" : ""} onClick={() => setStatusFilter(value)}>{label}</button>)}</div><select aria-label="Filter by doctor" value={doctorFilter} onChange={(event) => setDoctorFilter(event.target.value)}><option value="all">All doctors</option>{initialData.doctors.map((doctor) => <option key={doctor.id} value={doctor.name}>{doctor.name}</option>)}</select><input className="live-search-input" placeholder="Search patient or reference" value={apptSearch} onChange={(event) => setApptSearch(event.target.value)} /></div>
          {visibleAppointments.length === 0 ? <p className="live-empty">{appointments.length === 0 ? "No appointments for this day." : "No appointments match these filters."}</p> : <div className="live-table-wrap"><table className="live-table"><thead><tr><th>Time</th><th>Patient</th><th>Doctor</th><th>Department</th><th>Visit</th><th>Status</th><th /></tr></thead><tbody>{visibleAppointments.map((appointment) => { const action = nextAction(appointment); const cancellable = initialData.role !== ClinicRole.DOCTOR && (appointment.status === AppointmentStatus.BOOKED || appointment.status === AppointmentStatus.ARRIVED); return <tr key={appointment.id}><td>{formatAppointmentTime(appointment.startsAt, initialData.timezone)}</td><td><strong>{appointment.patient.fullName}</strong><small>{appointment.reference}</small></td><td>{appointment.doctor.membership.user.displayName}</td><td>{appointment.department.name}</td><td>{appointment.visitType.replaceAll("_", " ").toLowerCase()}</td><td><span className={`live-status ${appointment.status.toLowerCase().replaceAll("_", "-")}`}>{appointmentStatusLabel(appointment.status)}</span></td><td className="reception-actions">{action && <button className="button button-outline button-small" onClick={() => updateAppointment(appointment, action.status)}>{action.label}</button>}{cancellable && <button className="button button-quiet button-small reception-cancel" onClick={() => cancelAppointment(appointment)}>Cancel</button>}</td></tr>; })}</tbody></table></div>}
        </section>}
        {view === "whatsapp" && <InboxPanel timezone={initialData.timezone} />}
        {view === "patients" && <section className="live-panel"><div className="live-panel-heading"><div><h2>Patient directory</h2><p>Contact information only · clinical history is not included in this view.</p></div><input className="live-search-input" placeholder="Search name or phone" value={search} onChange={(event) => setSearch(event.target.value)} /></div><div className="live-table-wrap"><table className="live-table"><thead><tr><th>Patient</th><th>Phone</th><th>Date of birth</th></tr></thead><tbody>{visiblePatients.map((patient) => <tr key={patient.id}><td><strong>{patient.fullName}</strong></td><td>{patient.phone}</td><td>{patient.dateOfBirth ? new Intl.DateTimeFormat("en", { timeZone: "UTC", dateStyle: "medium" }).format(new Date(patient.dateOfBirth)) : "—"}</td></tr>)}</tbody></table>{visiblePatients.length === 0 && <p className="live-empty">No patients match this search.</p>}</div></section>}
      </div>
    </main>
  );
}
