"use client";

import { useEffect, useState } from "react";

// Reception's "Patient came?" control for a booked appointment.
// Yes checks the patient in; No records a no-show, which is allowed once the appointment time has started.
export default function ArrivalPrompt(props: {
  startsAt: string;
  patientName: string;
  canCheckIn: boolean;
  onArrived: () => void;
  onNoShow: () => void;
}) {
  const { startsAt, patientName, canCheckIn, onArrived, onNoShow } = props;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const started = new Date(startsAt).valueOf() <= now;
  if (!canCheckIn && !started) return null;

  return (
    <span className="arrival-prompt" role="group" aria-label={`Has ${patientName} come?`}>
      <span className="arrival-prompt-label">Patient came?</span>
      {canCheckIn && <button type="button" className="button button-small arrival-yes" onClick={onArrived}>Yes</button>}
      <button
        type="button"
        className="button button-small arrival-no"
        disabled={!started}
        title={started ? "Mark as no-show and release the slot" : "Available once the appointment time starts"}
        onClick={() => {
          if (window.confirm(`Mark ${patientName} as not arrived (no-show)? The slot will be released.`)) onNoShow();
        }}
      >
        No
      </button>
    </span>
  );
}
