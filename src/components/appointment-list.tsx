"use client";

import { useCallback, useEffect, useState } from "react";

type Range = "upcoming" | "week" | "past" | "custom";
type ListAppointment = {
  id: string;
  reference: string;
  startsAt: string;
  status: "BOOKED" | "ARRIVED" | "IN_CONSULTATION" | "COMPLETED" | "CANCELLED";
  visitType: string;
  source: "RECEPTION" | "DOCTOR" | "WHATSAPP";
  patient: { id: string; fullName: string; phone: string };
  doctor: { membership: { user: { displayName: string } } };
  department: { name: string };
};

const ranges: Array<[Range, string]> = [["upcoming", "Upcoming"], ["week", "Next 7 days"], ["past", "Past"], ["custom", "Date range"]];
const statuses: Array<[string, string]> = [["", "Any status"], ["BOOKED", "Booked"], ["ARRIVED", "Waiting"], ["IN_CONSULTATION", "In consultation"], ["COMPLETED", "Completed"], ["CANCELLED", "Cancelled"]];
const sources: Array<[string, string]> = [["", "Any source"], ["WHATSAPP", "WhatsApp"], ["RECEPTION", "Reception"], ["DOCTOR", "Doctor"]];
const sourceLabels: Record<ListAppointment["source"], string> = { WHATSAPP: "WhatsApp", RECEPTION: "Reception", DOCTOR: "Doctor" };

function statusLabel(status: string) {
  return status.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dayOf(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(iso));
}

export default function AppointmentList({
  timezone,
  today,
  doctors,
  onOpenPatient,
  onMessage,
}: {
  timezone: string;
  today: string;
  doctors: Array<{ id: string; name: string }>;
  onOpenPatient: (patientId: string) => void;
  onMessage: (text: string) => void;
}) {
  const [range, setRange] = useState<Range>("upcoming");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [rows, setRows] = useState<ListAppointment[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async (nextPage: number) => {
    const params = new URLSearchParams({ list: "1", range, page: String(nextPage) });
    if (range === "custom") {
      params.set("from", from);
      params.set("to", to);
    }
    if (query) params.set("q", query);
    if (doctorId) params.set("doctorId", doctorId);
    if (status) params.set("status", status);
    if (source) params.set("source", source);
    setLoading(true);
    try {
      const response = await fetch(`/api/appointments?${params}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to load appointments.");
      setRows((current) => nextPage === 0 ? result.appointments : [...current, ...result.appointments]);
      setHasMore(result.hasMore);
      setPage(nextPage);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load appointments.");
    } finally {
      setLoading(false);
    }
  }, [range, from, to, query, doctorId, status, source]);

  useEffect(() => {
    const first = window.setTimeout(() => load(0), 0);
    return () => window.clearTimeout(first);
  }, [load]);

  async function changeStatus(appointment: ListAppointment, next: "ARRIVED" | "CANCELLED") {
    if (next === "CANCELLED" && !window.confirm(`Cancel ${appointment.patient.fullName}'s appointment (${appointment.reference})? The slot will be released.`)) return;
    try {
      const response = await fetch(`/api/appointments/${appointment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to update appointment.");
      setRows((current) => current.map((row) => row.id === appointment.id ? { ...row, status: result.appointment.status } : row));
      onMessage(`${next === "ARRIVED" ? "Checked in" : "Cancelled"} · ${appointment.patient.fullName}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update appointment.");
    }
  }

  const fullDate = new Intl.DateTimeFormat("en", { timeZone: timezone, weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const time = new Intl.DateTimeFormat("en", { timeZone: timezone, hour: "numeric", minute: "2-digit" });

  return (
    <section className="live-panel">
      <div className="live-panel-heading">
        <div><h2>All appointments</h2><p>Every booking across all dates · search by patient name, phone or reference</p></div>
        <input className="live-search-input" placeholder="Search patient, phone or reference" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>
      <div className="reception-filters">
        <div className="reception-chips" role="group" aria-label="Date range">
          {ranges.map(([value, label]) => <button key={value} type="button" className={range === value ? "selected" : ""} onClick={() => setRange(value)}>{label}</button>)}
        </div>
        {range === "custom" && (
          <span className="appointment-list-dates">
            <input type="date" aria-label="From" value={from} onChange={(event) => event.target.value && setFrom(event.target.value)} />
            <span>to</span>
            <input type="date" aria-label="To" min={from} value={to} onChange={(event) => event.target.value && setTo(event.target.value)} />
          </span>
        )}
        <select aria-label="Filter by doctor" value={doctorId} onChange={(event) => setDoctorId(event.target.value)}><option value="">All doctors</option>{doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}</option>)}</select>
        <select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)}>{statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <select aria-label="Filter by source" value={source} onChange={(event) => setSource(event.target.value)}>{sources.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      </div>
      {error && <p className="live-error" role="alert">{error}</p>}
      {rows.length === 0 ? (
        <p className="live-empty">{loading ? "Loading appointments…" : "No appointments match these filters."}</p>
      ) : (
        <div className="live-table-wrap">
          <table className="live-table">
            <thead><tr><th>Date</th><th>Patient</th><th>Doctor</th><th>Department</th><th>Source</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rows.map((appointment) => {
                const isToday = dayOf(appointment.startsAt, timezone) === today;
                const cancellable = appointment.status === "BOOKED" || appointment.status === "ARRIVED";
                return (
                  <tr key={appointment.id}>
                    <td><strong>{fullDate.format(new Date(appointment.startsAt))}</strong><small>{time.format(new Date(appointment.startsAt))}{isToday ? " · Today" : ""}</small></td>
                    <td><button type="button" className="patient-link" onClick={() => onOpenPatient(appointment.patient.id)}>{appointment.patient.fullName}</button><small>{appointment.patient.phone} · {appointment.reference}</small></td>
                    <td>{appointment.doctor.membership.user.displayName}</td>
                    <td>{appointment.department.name}</td>
                    <td><span className={`recent-booking-source ${appointment.source.toLowerCase()}`}>{sourceLabels[appointment.source]}</span></td>
                    <td><span className={`live-status ${appointment.status.toLowerCase().replaceAll("_", "-")}`}>{statusLabel(appointment.status)}</span></td>
                    <td className="reception-actions">
                      {appointment.status === "BOOKED" && isToday && <button className="button button-outline button-small" onClick={() => changeStatus(appointment, "ARRIVED")}>Check in</button>}
                      {cancellable && <button className="button button-quiet button-small reception-cancel" onClick={() => changeStatus(appointment, "CANCELLED")}>Cancel</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {hasMore && <button type="button" className="recent-bookings-more" disabled={loading} onClick={() => load(page + 1)}>{loading ? "Loading…" : "Load more"}</button>}
    </section>
  );
}
