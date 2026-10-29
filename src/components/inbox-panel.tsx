"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type ConversationRow = {
  id: string;
  phone: string;
  displayName: string | null;
  mode: "BOT" | "HUMAN";
  state: string;
  isSimulated: boolean;
  optedOutAt: string | null;
  lastMessageAt: string | null;
  patient: { id: string; fullName: string } | null;
  assignedMembership: { id: string; user: { displayName: string } } | null;
  messages: { body: string; direction: string }[];
};
type Detail = {
  conversation: Omit<ConversationRow, "messages" | "lastMessageAt">;
  messages: { id: string; direction: "INBOUND" | "OUTBOUND"; sender: string; body: string; status: string; errorCode: string | null; createdAt: string }[];
  appointments: { id: string; reference: string; startsAt: string; status: string; source: string }[];
  staff: { id: string; user: { displayName: string } }[];
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((json as { error?: string }).error ?? "Request failed.");
  return json as T;
}

export default function InboxPanel({ timezone }: { timezone: string }) {
  const [rows, setRows] = useState<ConversationRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const list = await api<{ conversations: ConversationRow[] }>("/api/inbox/conversations");
      setRows(list.conversations);
      if (selected) setDetail(await api<Detail>(`/api/inbox/conversations/${selected}`));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load the inbox.");
    }
  }, [selected]);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const timer = setInterval(refresh, 5000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [refresh]);

  async function act(body: object) {
    if (!selected) return;
    setBusy(true);
    try {
      await api(`/api/inbox/conversations/${selected}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    const value = text;
    setText("");
    await act({ action: "reply", text: value });
  }

  const time = (iso: string) => new Intl.DateTimeFormat("en", { timeZone: timezone, hour: "numeric", minute: "2-digit", day: "numeric", month: "short" }).format(new Date(iso));
  const conversation = detail?.conversation;

  return (
    <section className="live-panel">
      <div className="live-panel-heading"><div><h2>WhatsApp inbox</h2><p>{rows.length} conversations · refreshes every few seconds</p></div></div>
      {error && <p className="live-message" role="alert">{error}</p>}
      {rows.length === 0 ? <p className="live-empty">No conversations yet.</p> : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 300px) 1fr", gap: 16 }}>
          <div style={{ display: "grid", gap: 6, alignContent: "start" }}>
            {rows.map((row) => (
              <button key={row.id} className={`button button-outline ${selected === row.id ? "selected" : ""}`} style={{ textAlign: "left", display: "grid", gap: 2 }} onClick={() => setSelected(row.id)}>
                <strong>{row.patient?.fullName ?? row.displayName ?? `+${row.phone}`} {row.isSimulated && <small>(simulated)</small>}</strong>
                <small>{row.mode === "HUMAN" ? "👤 Human" : "🤖 Bot"}{row.optedOutAt ? " · opted out" : ""} · {row.messages[0]?.body.slice(0, 40) ?? ""}</small>
              </button>
            ))}
          </div>
          <div>
            {!detail || !conversation ? <p className="live-empty">Select a conversation.</p> : (
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <strong>{conversation.patient?.fullName ?? conversation.displayName ?? `+${conversation.phone}`}</strong>
                  <small>+{conversation.phone} · {conversation.state.replaceAll("_", " ").toLowerCase()}</small>
                  {conversation.isSimulated && <small>SIMULATED · not sent to WhatsApp</small>}
                  <span style={{ flex: 1 }} />
                  {conversation.mode === "BOT"
                    ? <button className="button button-outline button-small" disabled={busy} onClick={() => act({ action: "pause" })}>Take over</button>
                    : <button className="button button-outline button-small" disabled={busy} onClick={() => act({ action: "resume" })}>Return to bot</button>}
                  <select aria-label="Assign conversation" value={conversation.assignedMembership?.id ?? ""} disabled={busy} onChange={(event) => act({ action: "assign", membershipId: event.target.value || null })}>
                    <option value="">Unassigned</option>
                    {detail.staff.map((member) => <option key={member.id} value={member.id}>{member.user.displayName}</option>)}
                  </select>
                </div>
                {conversation.mode === "HUMAN" && <p className="live-message">A person is handling this chat. The bot is paused.</p>}
                <div style={{ display: "grid", gap: 6, maxHeight: 360, overflowY: "auto", padding: 8, border: "1px solid #ddd", borderRadius: 8 }}>
                  {detail.messages.map((message) => (
                    <div key={message.id} style={{ justifySelf: message.direction === "INBOUND" ? "start" : "end", maxWidth: "80%", whiteSpace: "pre-wrap", background: message.direction === "INBOUND" ? "#f1f1f1" : "#e3f2e6", padding: "6px 10px", borderRadius: 10 }}>
                      {message.body}
                      <small style={{ display: "block", opacity: 0.6 }}>{message.sender.toLowerCase()} · {time(message.createdAt)}{message.direction === "OUTBOUND" ? ` · ${message.status.toLowerCase()}${message.errorCode ? ` (${message.errorCode.toLowerCase()})` : ""}` : ""}</small>
                    </div>
                  ))}
                </div>
                <form onSubmit={send} style={{ display: "flex", gap: 8 }}>
                  <input style={{ flex: 1 }} value={text} maxLength={1500} placeholder="Reply as reception (this takes over the chat)" aria-label="Reply" onChange={(event) => setText(event.target.value)} />
                  <button className="button button-primary" disabled={busy || !text.trim()}>Send</button>
                </form>
                <div>
                  <small>Linked record: {conversation.patient ? `${conversation.patient.fullName}` : "no patient linked yet"}</small>
                  {detail.appointments.length > 0 && <ul>{detail.appointments.map((a) => <li key={a.id}><small>{a.reference} · {time(a.startsAt)} · {a.status.toLowerCase()} · via {a.source.toLowerCase()}</small></li>)}</ul>}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
