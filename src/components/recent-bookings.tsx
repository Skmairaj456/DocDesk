"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type RecentBooking = {
  id: string;
  reference: string;
  startsAt: string;
  status: string;
  visitType: string;
  source: "RECEPTION" | "DOCTOR" | "WHATSAPP";
  createdAt: string;
  patient: { id: string; fullName: string };
  doctor: { membership: { user: { displayName: string } } };
  department: { name: string };
};

const sourceLabels: Record<RecentBooking["source"], string> = {
  WHATSAPP: "WhatsApp",
  RECEPTION: "Reception",
  DOCTOR: "Doctor",
};

function visitLabel(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("en", { timeZone: timezone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

function bookedAgo(iso: string, now: number) {
  const minutes = Math.max(0, Math.round((now - new Date(iso).valueOf()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export function bookingDay(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(iso));
}

export default function RecentBookings({
  timezone,
  showDoctor,
  onOpen,
}: {
  timezone: string;
  showDoctor: boolean;
  onOpen: (booking: RecentBooking) => void;
}) {
  const [bookings, setBookings] = useState<RecentBooking[] | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const seen = useRef<Set<string> | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/appointments?recent=1");
    if (!response.ok) return;
    const result = (await response.json()) as { appointments: RecentBooking[] };
    // Anything not present on the first load arrived while this screen was open.
    if (seen.current) {
      const arrived = result.appointments.filter((booking) => !seen.current!.has(booking.id)).map((booking) => booking.id);
      if (arrived.length) setFresh((current) => new Set([...current, ...arrived]));
    }
    seen.current = new Set(result.appointments.map((booking) => booking.id));
    setBookings(result.appointments);
    setNow(Date.now());
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => refresh().catch(() => undefined), 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh().catch(() => undefined);
    }, 10_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [refresh]);

  if (!bookings) return null;
  const visible = expanded ? bookings : bookings.slice(0, 5);

  return (
    <section className="recent-bookings" aria-label="New bookings">
      <div className="recent-bookings-heading">
        <div>
          <h2>New bookings {fresh.size > 0 && <span className="recent-bookings-badge">{fresh.size} new</span>}</h2>
          <p>Booked in the last 3 days, for any date · updates automatically</p>
        </div>
        {fresh.size > 0 && <button type="button" className="button button-quiet button-small" onClick={() => setFresh(new Set())}>Mark seen</button>}
      </div>
      {bookings.length === 0 ? (
        <p className="recent-bookings-empty">No new bookings yet. WhatsApp and reception bookings will appear here.</p>
      ) : (
        <ul>
          {visible.map((booking) => (
            <li key={booking.id}>
              <button
                type="button"
                className={`recent-booking${fresh.has(booking.id) ? " is-new" : ""}${booking.status === "CANCELLED" ? " is-cancelled" : ""}`}
                onClick={() => {
                  setFresh((current) => {
                    const next = new Set(current);
                    next.delete(booking.id);
                    return next;
                  });
                  onOpen(booking);
                }}
              >
                <span className={`recent-booking-source ${booking.source.toLowerCase()}`}>{sourceLabels[booking.source]}</span>
                <span className="recent-booking-person">
                  <strong>{booking.patient.fullName}</strong>
                  <small>{showDoctor ? `${booking.doctor.membership.user.displayName} · ` : ""}{booking.department.name} · {booking.reference}</small>
                </span>
                <span className="recent-booking-when">
                  <strong>{visitLabel(booking.startsAt, timezone)}</strong>
                  <small>{booking.status === "CANCELLED" ? "Cancelled" : `Booked ${bookedAgo(booking.createdAt, now)}`}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {bookings.length > 5 && (
        <button type="button" className="recent-bookings-more" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Show fewer" : `Show all ${bookings.length}`}
        </button>
      )}
    </section>
  );
}
