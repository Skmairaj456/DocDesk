"use client";

import type { VisitOutcome } from "@prisma/client";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { LiveWorkspaceData } from "@/components/live-clinic-workspace";
import RecentBookings, { bookingDay } from "@/components/recent-bookings";
import { localDateTimeAsUtc } from "@/lib/booking-time.mjs";

type Appointment = LiveWorkspaceData["appointments"][number];
type ConsultationData = {
  id: string;
  note: string;
  outcome: VisitOutcome | null;
  completedAt: string | null;
  followUp: { dueAt: string; type: string; reasonInternal: string; status: string } | null;
};
type PatientRecord = {
  id: string;
  fullName: string;
  phone: string;
  dateOfBirth: string | null;
  sex: string | null;
  createdAt: string;
  appointments: Array<{
    id: string;
    reference: string;
    startsAt: string;
    status: string;
    visitType: string;
    department: { name: string };
    doctorName: string;
  }>;
  consultations: Array<{
    id: string;
    note: string;
    outcome: VisitOutcome | null;
    createdAt: string;
    completedAt: string | null;
    followUp: { dueAt: string; type: string; status: string; reasonInternal: string } | null;
  }>;
};
type FollowUp = {
  id: string;
  dueAt: string;
  type: "FOLLOW_UP" | "REVISION";
  reasonInternal: string;
  status: "OPEN" | "BOOKED";
  patient: { id: string; fullName: string; phone: string };
  department: { id: string; name: string };
  bookedAppointment: { startsAt: string; reference: string } | null;
};
type ConsultationResponse = {
  appointmentStatus: string;
  patient: PatientRecord;
  consultation: ConsultationData | null;
};
type View = "queue" | "upcoming" | "patients" | "follow-ups";
type QueueFilter = "all" | "waiting" | "active" | "completed";
type AppointmentAction = { appointment: Appointment; mode: "reschedule" | "cancel" };

const UPCOMING_DAYS = 14;

const outcomeLabels: Record<VisitOutcome, string> = {
  STABLE: "Stable",
  IMPROVING: "Improving",
  REFERRED: "Referred",
  DISCHARGED: "Discharged",
};

function formatTime(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("en", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

function formatDate(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("en", { timeZone: timezone, weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function dayOf(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(iso));
}

function dayParts(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  return {
    weekday: new Intl.DateTimeFormat("en", { weekday: "short", timeZone: "UTC" }).format(value),
    day: new Intl.DateTimeFormat("en", { day: "numeric", timeZone: "UTC" }).format(value),
    month: new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(value),
    long: new Intl.DateTimeFormat("en", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(value),
  };
}

function patientAge(dateOfBirth: string | null) {
  if (!dateOfBirth) return "Age not recorded";
  const birthDate = new Date(dateOfBirth);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getUTCFullYear();
  if (
    today.getMonth() < birthDate.getUTCMonth() ||
    (today.getMonth() === birthDate.getUTCMonth() && today.getDate() < birthDate.getUTCDate())
  ) age -= 1;
  return `${age} years`;
}

function statusLabel(status: string) {
  return status.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function defaultFollowUpDate() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return new Intl.DateTimeFormat("en-CA").format(date);
}

function localDateTimeParts(iso: string, timezone: string) {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(iso));
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(new Date(iso));
  return { date, time };
}

async function responseJson<T>(response: Response): Promise<T> {
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "The request could not be completed.");
  return result as T;
}

export default function DoctorWorkspace(initialData: LiveWorkspaceData) {
  const doctor = initialData.doctors[0];
  const doctorDepartments = initialData.departments
    .filter((department) => doctor?.departmentIds.includes(department.id))
    .map((department) => department.name);
  const [appointments, setAppointments] = useState(initialData.appointments);
  const [upcoming, setUpcoming] = useState(initialData.appointments);
  const [now, setNow] = useState(() => Date.now());
  const [scheduleDate, setScheduleDate] = useState(initialData.localDate);
  const [view, setView] = useState<View>("queue");
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("all");
  const [search, setSearch] = useState("");
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [appointmentAction, setAppointmentAction] = useState<AppointmentAction | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [patientRecord, setPatientRecord] = useState<PatientRecord | null>(null);
  const [savedConsultation, setSavedConsultation] = useState<ConsultationData | null>(null);
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState<VisitOutcome | "">("");
  const [needsFollowUp, setNeedsFollowUp] = useState(false);
  const [followUpDate, setFollowUpDate] = useState(defaultFollowUpDate);
  const [followUpType, setFollowUpType] = useState<"FOLLOW_UP" | "REVISION">("FOLLOW_UP");
  const [followUpReason, setFollowUpReason] = useState("");
  const [bookingTask, setBookingTask] = useState<FollowUp | null>(null);
  const [bookingDate, setBookingDate] = useState(initialData.localDate);
  const [bookingTime, setBookingTime] = useState("09:00");
  const [statusFilter, setStatusFilter] = useState<"all" | "OPEN" | "BOOKED">("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const filteredAppointments = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return appointments.filter((appointment) => {
      const matchesSearch = !term ||
        `${appointment.patient.fullName} ${appointment.reference} ${appointment.department.name}`.toLocaleLowerCase().includes(term);
      const matchesFilter =
        queueFilter === "all" ||
        (queueFilter === "waiting" && ["BOOKED", "ARRIVED"].includes(appointment.status)) ||
        (queueFilter === "active" && appointment.status === "IN_CONSULTATION") ||
        (queueFilter === "completed" && appointment.status === "COMPLETED");
      return matchesSearch && matchesFilter;
    });
  }, [appointments, queueFilter, search]);

  const patientList = useMemo(() => {
    const byId = new Map<string, { id: string; fullName: string; appointmentCount: number; latestVisit: string }>();
    for (const appointment of upcoming) {
      const existing = byId.get(appointment.patient.id);
      if (existing) existing.appointmentCount += 1;
      else byId.set(appointment.patient.id, {
        id: appointment.patient.id,
        fullName: appointment.patient.fullName,
        appointmentCount: 1,
        latestVisit: appointment.startsAt,
      });
    }
    const term = search.trim().toLocaleLowerCase();
    return [...byId.values()].filter((patient) => !term || patient.fullName.toLocaleLowerCase().includes(term));
  }, [upcoming, search]);

  const visibleFollowUps = followUps.filter((followUp) => statusFilter === "all" || followUp.status === statusFilter);

  useEffect(() => {
    fetchFollowUps().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Unable to load follow-ups."));
    loadUpcoming().catch(() => undefined);
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
    // Initial load only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchFollowUps() {
    const result = await responseJson<{ followUps: FollowUp[] }>(await fetch("/api/doctor/follow-ups"));
    setFollowUps(result.followUps);
  }

  async function loadUpcoming() {
    const result = await responseJson<{ appointments: Appointment[] }>(
      await fetch(`/api/appointments?date=${initialData.localDate}&to=${addDays(initialData.localDate, UPCOMING_DAYS - 1)}`),
    );
    setUpcoming(result.appointments);
  }

  async function refreshAppointments(date: string) {
    const [result] = await Promise.all([
      responseJson<{ appointments: Appointment[] }>(await fetch(`/api/appointments?date=${encodeURIComponent(date)}`)),
      loadUpcoming().catch(() => undefined),
    ]);
    setAppointments(result.appointments);
    setScheduleDate(date);
  }

  // WhatsApp bookings arrive without any action on this screen, so keep the queue current.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshAppointments(scheduleDate).catch(() => undefined);
    }, 10_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleDate]);

  function selectDay(date: string) {
    if (date >= initialData.localDate && date <= addDays(initialData.localDate, UPCOMING_DAYS - 1)) {
      setAppointments(upcoming.filter((appointment) => dayOf(appointment.startsAt, initialData.timezone) === date));
      setScheduleDate(date);
      return;
    }
    refreshAppointments(date).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Unable to load the schedule."));
  }

  function showSuccess(text: string) {
    setMessage(text);
    window.setTimeout(() => setMessage(""), 4500);
  }

  async function openConsultation(appointment: Appointment) {
    setBusy(true);
    setError("");
    try {
      const result = await responseJson<ConsultationResponse>(
        await fetch(`/api/appointments/${appointment.id}/consultation`),
      );
      setSelectedAppointment(appointment);
      setPatientRecord(result.patient);
      setSavedConsultation(result.consultation);
      setNote(result.consultation?.note ?? "");
      setOutcome(result.consultation?.outcome ?? "");
      setNeedsFollowUp(Boolean(result.consultation?.followUp));
      setFollowUpDate(result.consultation?.followUp
        ? new Intl.DateTimeFormat("en-CA", { timeZone: initialData.timezone }).format(new Date(result.consultation.followUp.dueAt))
        : defaultFollowUpDate());
      setFollowUpType(result.consultation?.followUp?.type === "REVISION" ? "REVISION" : "FOLLOW_UP");
      setFollowUpReason(result.consultation?.followUp?.reasonInternal ?? "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to open this patient record.");
    } finally {
      setBusy(false);
    }
  }

  async function startVisit(appointment: Appointment) {
    setBusy(true);
    setError("");
    try {
      await responseJson(await fetch(`/api/appointments/${appointment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "IN_CONSULTATION" }),
      }));
      const updated = { ...appointment, status: "IN_CONSULTATION" as Appointment["status"] };
      setAppointments((current) => current.map((entry) => entry.id === appointment.id ? updated : entry));
      setUpcoming((current) => current.map((entry) => entry.id === appointment.id ? updated : entry));
      await openConsultation(updated);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to start this visit.");
    } finally {
      setBusy(false);
    }
  }

  function manageAppointment(appointment: Appointment, mode: AppointmentAction["mode"]) {
    const local = localDateTimeParts(appointment.startsAt, initialData.timezone);
    setAppointmentAction({ appointment, mode });
    setRescheduleDate(local.date);
    setRescheduleTime(local.time);
    setCancelReason("");
    setError("");
  }

  async function submitAppointmentAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!appointmentAction || !doctor) return;
    setBusy(true);
    setError("");
    try {
      if (appointmentAction.mode === "cancel") {
        await responseJson(await fetch(`/api/appointments/${appointmentAction.appointment.id}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: cancelReason }),
        }));
        await refreshAppointments(scheduleDate);
        setAppointmentAction(null);
        showSuccess("Appointment cancelled and removed from the active schedule. Its history was retained.");
      } else {
        const startsAt = localDateTimeAsUtc(rescheduleDate, rescheduleTime, initialData.timezone);
        const duration = new Date(appointmentAction.appointment.endsAt).valueOf() -
          new Date(appointmentAction.appointment.startsAt).valueOf();
        const endsAt = new Date(startsAt.valueOf() + duration);
        await responseJson(await fetch(`/api/appointments/${appointmentAction.appointment.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "reschedule",
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
          }),
        }));
        await refreshAppointments(rescheduleDate);
        setAppointmentAction(null);
        showSuccess(`Appointment rescheduled to ${rescheduleDate} at ${rescheduleTime}.`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update this appointment.");
    } finally {
      setBusy(false);
    }
  }

  async function saveConsultation(event: FormEvent<HTMLFormElement> | undefined, complete: boolean) {
    event?.preventDefault();
    if (!selectedAppointment) return;
    setBusy(true);
    setError("");
    try {
      const followUp = needsFollowUp
        ? {
            dueAt: localDateTimeAsUtc(followUpDate, "12:00", initialData.timezone).toISOString(),
            type: followUpType,
            reason: followUpReason,
          }
        : null;
      const result = await responseJson<{ consultation: ConsultationData }>(
        await fetch(`/api/appointments/${selectedAppointment.id}/consultation`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            note,
            complete,
            outcome: complete ? outcome || null : null,
            followUp,
          }),
        }),
      );
      setSavedConsultation(result.consultation);
      if (complete) {
        const markCompleted = (current: Appointment[]) => current.map((appointment) =>
          appointment.id === selectedAppointment.id
            ? { ...appointment, status: "COMPLETED" as Appointment["status"] }
            : appointment,
        );
        setAppointments(markCompleted);
        setUpcoming(markCompleted);
        setSelectedAppointment({ ...selectedAppointment, status: "COMPLETED" });
        await fetchFollowUps();
        showSuccess("Visit completed and saved to the patient record.");
      } else {
        showSuccess("Consultation draft saved.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save the consultation.");
    } finally {
      setBusy(false);
    }
  }

  async function bookFollowUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!bookingTask || !doctor) return;
    setBusy(true);
    setError("");
    try {
      const startsAt = localDateTimeAsUtc(bookingDate, bookingTime, initialData.timezone);
      const endsAt = new Date(startsAt.valueOf() + doctor.consultationMinutes * 60_000);
      const result = await responseJson<{ appointment: { reference: string } }>(
        await fetch("/api/appointments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            patientId: bookingTask.patient.id,
            departmentId: bookingTask.department.id,
            doctorId: doctor.id,
            followUpId: bookingTask.id,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            visitType: bookingTask.type,
          }),
        }),
      );
      await Promise.all([fetchFollowUps(), refreshAppointments(scheduleDate)]);
      setBookingTask(null);
      showSuccess(`Follow-up booked · ${result.appointment.reference}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to book this follow-up.");
    } finally {
      setBusy(false);
    }
  }

  const today = initialData.localDate;
  const todayAppointments = upcoming.filter((appointment) => dayOf(appointment.startsAt, initialData.timezone) === today);
  const arrivedCount = todayAppointments.filter((appointment) => appointment.status === "ARRIVED").length;
  const activeCount = todayAppointments.filter((appointment) => appointment.status === "IN_CONSULTATION").length;
  const completedCount = todayAppointments.filter((appointment) => appointment.status === "COMPLETED").length;
  const weekAheadCount = upcoming.filter((appointment) => {
    const day = dayOf(appointment.startsAt, initialData.timezone);
    return day > today && day <= addDays(today, 7) && ["BOOKED", "ARRIVED"].includes(appointment.status);
  }).length;
  const nextVisit = upcoming.find((appointment) =>
    ["BOOKED", "ARRIVED", "IN_CONSULTATION"].includes(appointment.status) && new Date(appointment.endsAt).valueOf() >= now) ?? null;
  const countsByDay = new Map<string, number>();
  for (const appointment of upcoming) {
    const day = dayOf(appointment.startsAt, initialData.timezone);
    countsByDay.set(day, (countsByDay.get(day) ?? 0) + 1);
  }
  const dayStrip = Array.from({ length: UPCOMING_DAYS }, (_, index) => addDays(today, index));
  const upcomingGroups = dayStrip
    .map((day) => ({ day, items: upcoming.filter((appointment) => dayOf(appointment.startsAt, initialData.timezone) === day) }))
    .filter((group) => group.items.length > 0);
  const hour = Number(new Intl.DateTimeFormat("en", { timeZone: initialData.timezone, hour: "numeric", hour12: false }).format(now)) % 24;
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  function startsIn(iso: string) {
    const minutes = Math.round((new Date(iso).valueOf() - now) / 60_000);
    if (minutes <= 0) return "happening now";
    if (minutes < 60) return `in ${minutes} min`;
    if (minutes < 24 * 60) return `in ${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
    return dayOf(iso, initialData.timezone) === addDays(today, 1) ? "tomorrow" : `on ${dayParts(dayOf(iso, initialData.timezone)).long}`;
  }
  const currentPatientName = patientRecord?.fullName ?? selectedAppointment?.patient.fullName ?? "";
  const isReadOnly = selectedAppointment?.status === "COMPLETED" || savedConsultation?.completedAt != null;
  const canEditConsultation = selectedAppointment?.status === "IN_CONSULTATION" && !isReadOnly;

  return (
    <main className="doctor-app">
      <header className="doctor-header">
        <Link className="doctor-brand" href="/" aria-label="DocDesk doctor home"><span className="brand-mark">d.</span><span><strong>docdesk</strong><small>DOCTOR WORKSPACE</small></span></Link>
        <div className="doctor-account"><span className="doctor-clinic">{initialData.clinicName}</span><span className="doctor-avatar">{doctor?.name.split(" ").slice(-1)[0]?.[0] ?? "D"}</span><form action="/auth/sign-out" method="post"><button className="button button-quiet" type="submit">Sign out</button></form></div>
      </header>
      <div className="doctor-content">
        <section className="doctor-hero">
          <div className="doctor-hero-copy">
            <p className="eyebrow">{dayParts(today).long.toUpperCase()}</p>
            <h1>{greeting}, {doctor?.name ?? "Doctor"}</h1>
            <p>{doctorDepartments.join(" · ") || "Your clinic schedule"} · {todayAppointments.length === 0 ? "No visits today." : `${todayAppointments.length} ${todayAppointments.length === 1 ? "visit" : "visits"} today, ${completedCount} done.`}</p>
            <span className="doctor-today-chip"><span className="doctor-live-dot" /> LIVE CLINIC WORKSPACE</span>
          </div>
          <div className="doctor-next-card">
            {nextVisit ? (
              <>
                <span className="doctor-next-label">{nextVisit.status === "IN_CONSULTATION" ? "IN CONSULTATION NOW" : "UP NEXT"}</span>
                <strong className="doctor-next-time">{formatTime(nextVisit.startsAt, initialData.timezone)}</strong>
                <span className="doctor-next-when">{nextVisit.status === "IN_CONSULTATION" ? "In progress" : startsIn(nextVisit.startsAt)}</span>
                <div className="doctor-next-person">
                  <span className="doctor-patient-mark">{nextVisit.patient.fullName.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span>
                  <span><strong>{nextVisit.patient.fullName}</strong><small>{nextVisit.visitType.replaceAll("_", " ").toLowerCase()} · {nextVisit.department.name}</small></span>
                </div>
                <div className="doctor-next-actions">
                  {nextVisit.status === "ARRIVED" && <button disabled={busy} className="button doctor-next-primary" onClick={() => startVisit(nextVisit)}>Start visit</button>}
                  {nextVisit.status === "IN_CONSULTATION" && <button disabled={busy} className="button doctor-next-primary" onClick={() => openConsultation(nextVisit)}>Open consultation</button>}
                  <button disabled={busy} className="button doctor-next-secondary" onClick={() => openConsultation(nextVisit)}>Patient details</button>
                </div>
              </>
            ) : (
              <div className="doctor-next-empty"><strong>You&apos;re all caught up</strong><span>No upcoming visits in the next {UPCOMING_DAYS} days.</span></div>
            )}
          </div>
        </section>

        <section className="doctor-metrics" aria-label="Clinic metrics">
          <article className="metric-blue"><span>Today’s visits</span><strong>{todayAppointments.length}</strong><small>On your schedule</small></article>
          <article className="metric-amber"><span>Waiting</span><strong>{arrivedCount}</strong><small>Checked in and ready</small></article>
          <article className="metric-violet"><span>In consultation</span><strong>{activeCount}</strong><small>Care in progress</small></article>
          <article className="metric-green"><span>Completed</span><strong>{completedCount}</strong><small>Visits documented</small></article>
          <article className="metric-teal"><span>Next 7 days</span><strong>{weekAheadCount}</strong><small>Upcoming bookings</small></article>
        </section>

        <RecentBookings
          timezone={initialData.timezone}
          showDoctor={false}
          onOpen={(booking) => {
            setQueueFilter("all");
            setView("queue");
            selectDay(bookingDay(booking.startsAt, initialData.timezone));
          }}
        />

        {error && <p className="live-error" role="alert">{error}</p>}
        {message && <p className="live-message" role="status">{message}</p>}

        <nav className="doctor-navigation" aria-label="Doctor workspace sections">
          <button className={view === "queue" ? "selected" : ""} onClick={() => setView("queue")}>Schedule <span>{appointments.length}</span></button>
          <button className={view === "upcoming" ? "selected" : ""} onClick={() => setView("upcoming")}>Upcoming <span>{upcoming.filter((appointment) => dayOf(appointment.startsAt, initialData.timezone) >= today && ["BOOKED", "ARRIVED"].includes(appointment.status)).length}</span></button>
          <button className={view === "patients" ? "selected" : ""} onClick={() => setView("patients")}>My patients <span>{patientList.length}</span></button>
          <button className={view === "follow-ups" ? "selected" : ""} onClick={() => setView("follow-ups")}>Follow-ups <span>{followUps.filter((task) => task.status === "OPEN").length}</span></button>
        </nav>

        {view === "upcoming" && (
          <section className="doctor-panel">
            <div className="doctor-panel-heading"><div><p className="eyebrow">NEXT {UPCOMING_DAYS} DAYS</p><h2>Upcoming appointments</h2><p>Everything booked for you, grouped by day.</p></div></div>
            {upcomingGroups.length === 0
              ? <div className="doctor-empty"><strong>Nothing booked yet</strong><span>New bookings from reception and WhatsApp appear here automatically.</span></div>
              : upcomingGroups.map((group) => {
                  const parts = dayParts(group.day);
                  return (
                    <div className="doctor-upcoming-day" key={group.day}>
                      <button className="doctor-upcoming-date" onClick={() => { selectDay(group.day); setView("queue"); }}>
                        <strong>{parts.day}</strong><span>{parts.month} · {parts.weekday}</span>
                      </button>
                      <div className="doctor-upcoming-list">
                        {group.items.map((appointment) => (
                          <button key={appointment.id} className="doctor-upcoming-item" onClick={() => openConsultation(appointment)}>
                            <time>{formatTime(appointment.startsAt, initialData.timezone)}</time>
                            <span className="doctor-patient-mark">{appointment.patient.fullName.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span>
                            <span className="doctor-upcoming-person"><strong>{appointment.patient.fullName}</strong><small>{appointment.visitType.replaceAll("_", " ").toLowerCase()} · {appointment.department.name}</small></span>
                            <span className={`doctor-status ${appointment.status.toLowerCase().replaceAll("_", "-")}`}>{statusLabel(appointment.status)}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
          </section>
        )}

        {view === "queue" && (
          <section className="doctor-panel">
            <div className="doctor-panel-heading">
              <div><p className="eyebrow">PATIENT FLOW</p><h2>{scheduleDate === today ? "Today’s queue" : dayParts(scheduleDate).long}</h2><p>Check each visit’s status and open its clinical record.</p></div>
              <div className="doctor-day-nav">
                <button className="button button-outline" aria-label="Previous day" onClick={() => selectDay(addDays(scheduleDate, -1))}>‹</button>
                <button className="button button-outline" disabled={scheduleDate === today} onClick={() => selectDay(today)}>Today</button>
                <button className="button button-outline" aria-label="Next day" onClick={() => selectDay(addDays(scheduleDate, 1))}>›</button>
                <label className="doctor-date-control">Schedule date<input aria-label="Schedule date" type="date" value={scheduleDate} onChange={(event) => event.target.value && selectDay(event.target.value)} /></label>
              </div>
            </div>
            <div className="doctor-day-strip" aria-label="Pick a day">
              {dayStrip.map((day) => {
                const parts = dayParts(day);
                const count = countsByDay.get(day) ?? 0;
                return (
                  <button key={day} className={`${day === scheduleDate ? "selected " : ""}${day === today ? "is-today" : ""}`} onClick={() => selectDay(day)}>
                    <small>{day === today ? "Today" : parts.weekday}</small>
                    <strong>{parts.day}</strong>
                    <span className={count ? "has-visits" : ""}>{count ? `${count} ${count === 1 ? "visit" : "visits"}` : "Free"}</span>
                  </button>
                );
              })}
            </div>
            <div className="doctor-toolbar">
              <div className="doctor-filters" aria-label="Filter appointments">
                {([["all", "All visits"], ["waiting", "Waiting"], ["active", "In consultation"], ["completed", "Completed"]] as const).map(([key, label]) =>
                  <button key={key} className={queueFilter === key ? "selected" : ""} onClick={() => setQueueFilter(key)}>{label}</button>,
                )}
              </div>
              <input aria-label="Search queue" className="live-search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search patient or reference" />
            </div>
            <div className="doctor-queue">
              {filteredAppointments.length === 0
                ? <div className="doctor-empty"><strong>No visits in this view</strong><span>Try another filter or date. New check-ins appear here automatically after reception checks them in.</span></div>
                : filteredAppointments.map((appointment) => {
                    const statusClass = appointment.status.toLowerCase().replaceAll("_", "-");
                    const action = appointment.status === "ARRIVED"
                      ? <button disabled={busy} className="button button-primary" onClick={() => startVisit(appointment)}>Start visit</button>
                      : appointment.status === "IN_CONSULTATION"
                        ? <button disabled={busy} className="button button-primary" onClick={() => openConsultation(appointment)}>Open consultation</button>
                        : appointment.status === "COMPLETED"
                          ? <button disabled={busy} className="button button-outline" onClick={() => openConsultation(appointment)}>Review record</button>
                          : <span className="doctor-awaiting">Awaiting patient check-in</span>;
                    return (
                      <article className="doctor-queue-row" key={appointment.id}>
                        <time className="doctor-visit-time">{formatTime(appointment.startsAt, initialData.timezone)}<small>{formatDate(appointment.startsAt, initialData.timezone)}</small></time>
                        <div className="doctor-patient-mark">{appointment.patient.fullName.split(" ").map((part) => part[0]).slice(0, 2).join("")}</div>
                        <div className="doctor-visit-person"><strong>{appointment.patient.fullName}</strong><span>{appointment.visitType.replaceAll("_", " ").toLowerCase()} · {appointment.department.name}</span><small>{appointment.reference}</small></div>
                        <span className={`doctor-status ${statusClass}`}>{statusLabel(appointment.status)}</span>
                        <div className="doctor-visit-action">
                          {action}
                          <button disabled={busy} className="button button-outline" onClick={() => openConsultation(appointment)}>Patient details</button>
                          {["BOOKED", "ARRIVED"].includes(appointment.status) && <button disabled={busy} className="button button-quiet" onClick={() => manageAppointment(appointment, "reschedule")}>Reschedule</button>}
                          {["BOOKED", "ARRIVED"].includes(appointment.status) && <button disabled={busy} className="button button-quiet doctor-delete-appointment" onClick={() => manageAppointment(appointment, "cancel")}>Delete appointment</button>}
                        </div>
                      </article>
                    );
                  })}
            </div>
          </section>
        )}

        {view === "patients" && (
          <section className="doctor-panel">
            <div className="doctor-panel-heading"><div><p className="eyebrow">CONTINUITY OF CARE</p><h2>Patients on your schedule</h2><p>Patient access is limited to appointments assigned to you.</p></div><input aria-label="Search patients" className="live-search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search patient" /></div>
            {patientList.length === 0
              ? <div className="doctor-empty"><strong>No patients found</strong><span>Patients linked to your appointments will appear here.</span></div>
              : <div className="doctor-patient-grid">{patientList.map((patient) => (
                  <article key={patient.id} className="doctor-patient-card">
                    <div className="doctor-patient-mark">{patient.fullName.split(" ").map((part) => part[0]).slice(0, 2).join("")}</div>
                    <div><strong>{patient.fullName}</strong><span>{patient.appointmentCount} visit{patient.appointmentCount === 1 ? "" : "s"} in today’s schedule</span></div>
                    <button className="button button-outline" onClick={() => {
                      const appointment = appointments.find((entry) => entry.patient.id === patient.id);
                      if (appointment) openConsultation(appointment);
                    }}>Open patient record</button>
                  </article>
                ))}</div>}
          </section>
        )}

        {view === "follow-ups" && (
          <section className="doctor-panel">
            <div className="doctor-panel-heading"><div><p className="eyebrow">CONTINUITY OF CARE</p><h2>Follow-up tasks</h2><p>Track requested reviews and book them into your available clinic hours.</p></div><select aria-label="Filter follow-ups" className="doctor-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">All tasks</option><option value="OPEN">Needs booking</option><option value="BOOKED">Booked</option></select></div>
            {visibleFollowUps.length === 0
              ? <div className="doctor-empty"><strong>No follow-up tasks yet</strong><span>Schedule a follow-up from a consultation and it will appear here for booking and tracking.</span></div>
              : <div className="doctor-followups">{visibleFollowUps.map((followUp) => (
                  <article className="doctor-followup-row" key={followUp.id}>
                    <div className="doctor-followup-icon">{followUp.type === "REVISION" ? "R" : "F"}</div>
                    <div className="doctor-followup-info"><strong>{followUp.patient.fullName}</strong><span>{followUp.type === "REVISION" ? "Revision" : "Follow-up"} · {followUp.department.name}</span><small>{followUp.reasonInternal}</small></div>
                    <div className="doctor-followup-due"><span>{followUp.status === "BOOKED" ? "Appointment booked" : "Requested for"}</span><strong>{followUp.bookedAppointment ? formatDate(followUp.bookedAppointment.startsAt, initialData.timezone) : formatDate(followUp.dueAt, initialData.timezone)}</strong>{followUp.bookedAppointment && <small>{formatTime(followUp.bookedAppointment.startsAt, initialData.timezone)} · {followUp.bookedAppointment.reference}</small>}</div>
                    {followUp.status === "OPEN" && <button className="button button-primary" onClick={() => { setBookingTask(followUp); setBookingDate(initialData.localDate); setBookingTime("09:00"); }}>Book follow-up</button>}
                    {followUp.status === "BOOKED" && <span className="doctor-status completed">Booked</span>}
                  </article>
                ))}</div>}
          </section>
        )}

        <footer className="doctor-footer"><span>DocDesk · care stays connected</span><span>Clinical notes are visible only to authorized clinicians.</span></footer>
      </div>

      {selectedAppointment && patientRecord && (
        <div className="doctor-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setSelectedAppointment(null); setPatientRecord(null); } }}>
          <section className="doctor-drawer" role="dialog" aria-modal="true" aria-labelledby="consultation-title">
            <header className="doctor-drawer-header"><div><p className="eyebrow">PATIENT CONSULTATION</p><h2 id="consultation-title">{currentPatientName}</h2><span>{patientAge(patientRecord.dateOfBirth)} · {patientRecord.sex ?? "Demographics"} · {selectedAppointment.reference}</span></div><button className="button button-quiet" onClick={() => { setSelectedAppointment(null); setPatientRecord(null); }}>Close</button></header>
            <div className="doctor-drawer-content">
              <section className="doctor-visit-context"><span>VISIT DETAILS</span><strong>{formatDate(selectedAppointment.startsAt, initialData.timezone)} · {formatTime(selectedAppointment.startsAt, initialData.timezone)}</strong><small>{selectedAppointment.visitType.replaceAll("_", " ").toLowerCase()} · {selectedAppointment.department.name} · {statusLabel(selectedAppointment.status)}</small></section>
              <section className="doctor-patient-details">
                <h3>Patient details</h3>
                <dl>
                  <div><dt>Full name</dt><dd>{patientRecord.fullName}</dd></div>
                  <div><dt>Phone</dt><dd><a href={`tel:${patientRecord.phone}`}>{patientRecord.phone}</a></dd></div>
                  <div><dt>Date of birth</dt><dd>{patientRecord.dateOfBirth ? new Intl.DateTimeFormat("en", { timeZone: "UTC", dateStyle: "long" }).format(new Date(patientRecord.dateOfBirth)) : "Not recorded"}</dd></div>
                  <div><dt>Age</dt><dd>{patientAge(patientRecord.dateOfBirth)}</dd></div>
                  <div><dt>Sex</dt><dd>{patientRecord.sex ?? "Not recorded"}</dd></div>
                  <div><dt>Patient since</dt><dd>{formatDate(patientRecord.createdAt, initialData.timezone)}</dd></div>
                </dl>
              </section>
              {patientRecord.appointments.length > 0 && <section className="doctor-history"><h3>Appointment history</h3>{patientRecord.appointments.map((visit) => (
                <article key={visit.id}>
                  <div><strong>{formatDate(visit.startsAt, initialData.timezone)} · {formatTime(visit.startsAt, initialData.timezone)} · {statusLabel(visit.status)}</strong>
                    <p>{visit.visitType.replaceAll("_", " ").toLowerCase()} · {visit.department.name} · {visit.doctorName}</p></div>
                  <small>{visit.reference}</small>
                </article>
              ))}</section>}
              {patientRecord.consultations.length > 0 && <section className="doctor-history"><h3>Clinical notes and care history</h3>{patientRecord.consultations.filter((visit) => visit.id !== savedConsultation?.id).map((visit) => (
                <article key={visit.id}><div><strong>{formatDate(visit.createdAt, initialData.timezone)}{visit.outcome ? ` · ${outcomeLabels[visit.outcome]}` : " · Draft"}</strong><p>{visit.note}</p></div>{visit.followUp && <small>{visit.followUp.type === "REVISION" ? "Revision" : "Follow-up"} · {formatDate(visit.followUp.dueAt, initialData.timezone)} · {statusLabel(visit.followUp.status)}</small>}</article>
              ))}</section>}
              {!canEditConsultation && !isReadOnly && <p className="doctor-locked-note">Consultation notes become available after this visit is started.</p>}
              {canEditConsultation && <form className="doctor-consultation-form" onSubmit={(event) => saveConsultation(event, false)}>
                <label htmlFor="consultation-note">Consultation note<textarea id="consultation-note" rows={7} maxLength={10_000} required disabled={isReadOnly} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Record the patient's concerns, examination findings, and plan. Do not enter automated diagnoses." /></label>
                {!isReadOnly && <label className="doctor-outcome-control">Visit outcome<select value={outcome} onChange={(event) => setOutcome(event.target.value as VisitOutcome | "")}><option value="">Choose outcome to complete</option>{Object.entries(outcomeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
                {!isReadOnly && <section className="doctor-followup-editor">
                  <label className="doctor-checkbox"><input type="checkbox" checked={needsFollowUp} onChange={(event) => setNeedsFollowUp(event.target.checked)} /> Schedule a follow-up or revision</label>
                  {needsFollowUp && <div className="doctor-followup-fields">
                    <label>Type<select value={followUpType} onChange={(event) => setFollowUpType(event.target.value as typeof followUpType)}><option value="FOLLOW_UP">Follow-up</option><option value="REVISION">Revision</option></select></label>
                    <label>Requested date<input required type="date" min={initialData.localDate} value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} /></label>
                    <label className="doctor-reason-field">Internal reason<input required maxLength={500} value={followUpReason} onChange={(event) => setFollowUpReason(event.target.value)} placeholder="Reason for the requested review" /></label>
                    <div className="doctor-message-preview"><span>NOTIFICATION PREVIEW · NOT SENT</span><p>“Please contact {initialData.clinicName} to arrange your {followUpType === "REVISION" ? "revision" : "follow-up"} after {followUpDate}.”</p></div>
                  </div>}
                </section>}
                {savedConsultation?.followUp && <p className="doctor-saved-followup">Follow-up saved for {formatDate(savedConsultation.followUp.dueAt, initialData.timezone)} · {statusLabel(savedConsultation.followUp.status)}.</p>}
                {!isReadOnly && <div className="doctor-consultation-actions">
                  <span>{savedConsultation ? "Draft changes save to the patient record." : "Start with a draft; complete when your notes are ready."}</span>
                  <button type="submit" className="button button-outline" disabled={busy}>{busy ? "Saving…" : "Save draft"}</button>
                  <button type="button" className="button button-primary" disabled={busy || !note.trim() || !outcome} onClick={(event) => {
                    if (event.currentTarget.form?.reportValidity()) void saveConsultation(undefined, true);
                  }}>Complete visit</button>
                </div>}
              </form>}
              {isReadOnly && <section className="doctor-consultation-form">
                {savedConsultation
                  ? <><label>Consultation note<textarea rows={7} disabled value={savedConsultation.note} /></label><p className="doctor-locked-note">This visit is completed. Its clinical record is preserved and read-only.</p></>
                  : <p className="doctor-locked-note">This visit was marked completed without a saved consultation note. No clinical record is available for this appointment.</p>}
              </section>}
            </div>
          </section>
        </div>
      )}

      {appointmentAction && (
        <div className="doctor-drawer-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busy) setAppointmentAction(null);
        }}>
          <section className="doctor-booking-dialog" role="dialog" aria-modal="true" aria-labelledby="appointment-action-title">
            <header className="doctor-drawer-header">
              <div>
                <p className="eyebrow">APPOINTMENT MANAGEMENT</p>
                <h2 id="appointment-action-title">{appointmentAction.mode === "reschedule" ? "Reschedule appointment" : "Delete appointment"}</h2>
                <span>{appointmentAction.appointment.patient.fullName} · {appointmentAction.appointment.reference}</span>
              </div>
              <button className="button button-quiet" disabled={busy} onClick={() => setAppointmentAction(null)}>Close</button>
            </header>
            <form className="doctor-booking-form" onSubmit={submitAppointmentAction}>
              {appointmentAction.mode === "reschedule" ? <>
                <label>New appointment date<input type="date" min={initialData.localDate} required value={rescheduleDate} onChange={(event) => setRescheduleDate(event.target.value)} /></label>
                <label>New start time<input type="time" required value={rescheduleTime} onChange={(event) => setRescheduleTime(event.target.value)} /></label>
                <p>The existing visit length is preserved. The clinic checks working hours and conflicts before saving.</p>
              </> : <>
                <p className="doctor-delete-warning">This removes the appointment from the active schedule by cancelling it. The appointment record and audit history are retained. Completed or in-progress visits cannot be deleted.</p>
                <label>Reason (optional)<input maxLength={250} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Reason for cancellation" /></label>
              </>}
              <div className="doctor-consultation-actions">
                <button type="button" className="button button-outline" disabled={busy} onClick={() => setAppointmentAction(null)}>Keep appointment</button>
                <button type="submit" className={`button ${appointmentAction.mode === "cancel" ? "button-danger" : "button-primary"}`} disabled={busy}>
                  {busy ? "Saving…" : appointmentAction.mode === "reschedule" ? "Save new time" : "Delete appointment"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {bookingTask && (
        <div className="doctor-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setBookingTask(null); }}>
          <section className="doctor-booking-dialog" role="dialog" aria-modal="true" aria-labelledby="followup-booking-title">
            <header className="doctor-drawer-header"><div><p className="eyebrow">FOLLOW-UP SCHEDULING</p><h2 id="followup-booking-title">Book {bookingTask.patient.fullName}</h2><span>{bookingTask.department.name} · {bookingTask.type === "REVISION" ? "Revision" : "Follow-up"}</span></div><button className="button button-quiet" onClick={() => setBookingTask(null)}>Close</button></header>
            <form className="doctor-booking-form" onSubmit={bookFollowUp}>
              <label>Appointment date<input type="date" min={initialData.localDate} required value={bookingDate} onChange={(event) => setBookingDate(event.target.value)} /></label>
              <label>Start time<input type="time" required value={bookingTime} onChange={(event) => setBookingTime(event.target.value)} /></label>
              <p>Visit length is {doctor?.consultationMinutes ?? 30} minutes. Working hours, clinic timezone, and conflicts are validated by the server before booking.</p>
              <div className="doctor-consultation-actions"><button type="button" className="button button-outline" onClick={() => setBookingTask(null)}>Cancel</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? "Booking…" : "Confirm appointment"}</button></div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
