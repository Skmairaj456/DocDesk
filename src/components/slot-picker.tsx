"use client";

import { useEffect, useState } from "react";

export type FreeSlot = { startsAt: string; endsAt: string; session: "morning" | "afternoon" | "evening" };

const SESSIONS = [
  { id: "morning", title: "Morning" },
  { id: "afternoon", title: "Afternoon" },
  { id: "evening", title: "Evening" },
] as const;

function timeLabel(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("en", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

// Shows the doctor's free times for one day as buttons, grouped by session.
export default function SlotPicker(props: {
  doctorId: string;
  departmentId: string;
  date: string;
  timezone: string;
  value: FreeSlot | null;
  onChange: (slot: FreeSlot | null) => void;
  refreshKey: number;
}) {
  const { doctorId, departmentId, date, timezone, value, onChange, refreshKey } = props;
  const requestKey = `${doctorId}|${departmentId}|${date}|${refreshKey}`;
  // Results are tagged with the request they answer, so a change of doctor or day shows "loading"
  // until its own answer arrives.
  const [loaded, setLoaded] = useState<{ key: string; slots: FreeSlot[]; error: string } | null>(null);
  const current = loaded?.key === requestKey ? loaded : null;
  const slots = current && !current.error ? current.slots : null;
  const error = current?.error ?? "";

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ doctorId, departmentId, date });
    fetch(`/api/appointments/slots?${params}`)
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Unable to load free times.");
        if (cancelled) return;
        setLoaded({ key: requestKey, slots: result.slots, error: "" });
        // Drop a previous choice that is no longer free (or belongs to another doctor or day).
        if (value && !result.slots.some((slot: FreeSlot) => slot.startsAt === value.startsAt)) onChange(null);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setLoaded({ key: requestKey, slots: [], error: caught instanceof Error ? caught.message : "Unable to load free times." });
      });
    return () => { cancelled = true; };
    // The current choice is checked against fresh results only; it must not trigger a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  return (
    <fieldset className="slot-picker">
      <legend>Time <small>{value ? `Selected ${timeLabel(value.startsAt, timezone)}` : "Choose a free time"}</small></legend>
      {error && <p className="slot-picker-note slot-picker-error" role="alert">{error}</p>}
      {!error && !slots && <p className="slot-picker-note">Loading free times…</p>}
      {!error && slots?.length === 0 && <p className="slot-picker-note">No free times on this day. Choose another date.</p>}
      {!error && slots && slots.length > 0 && SESSIONS.map((session) => {
        const inSession = slots.filter((slot) => slot.session === session.id);
        if (inSession.length === 0) return null;
        const range = `${timeLabel(inSession[0].startsAt, timezone)} – ${timeLabel(inSession[inSession.length - 1].endsAt, timezone)}`;
        return (
          <div className="slot-picker-session" key={session.id}>
            <span className="slot-picker-heading"><strong>{session.title}</strong> <small>{range} · {inSession.length} free</small></span>
            <div className="slot-picker-times" role="radiogroup" aria-label={`${session.title} times`}>
              {inSession.map((slot) => {
                const selected = value?.startsAt === slot.startsAt;
                return (
                  <button key={slot.startsAt} type="button" role="radio" aria-checked={selected} className={selected ? "selected" : ""} onClick={() => onChange(slot)}>
                    {timeLabel(slot.startsAt, timezone)}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </fieldset>
  );
}
