"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

type Option = { id: string; title: string; description?: string };
type Message = { id: string; direction: "INBOUND" | "OUTBOUND"; sender: string; body: string; status: string; interactive: Option[] | null };

export default function SimulatorChat() {
  const [phone, setPhone] = useState("919000000001");
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async (value: string) => {
    if (!/^\d{10,15}$/.test(value)) return;
    const response = await fetch(`/api/simulator/message?phone=${value}`);
    const json = await response.json();
    if (!response.ok) setError(json.error ?? "Unable to load.");
    else { setMessages(json.messages); setError(""); }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => load(phone), 0);
    const poll = setInterval(() => load(phone), 4000);
    return () => { clearTimeout(timer); clearInterval(poll); };
  }, [phone, load]);

  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [messages]);

  async function send(body: { text: string; optionId?: string }) {
    setBusy(true);
    try {
      const response = await fetch("/api/simulator/message", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, ...body }) });
      const json = await response.json();
      if (!response.ok) setError(json.error ?? "Send failed.");
      else { setMessages(json.messages); setError(""); }
    } finally { setBusy(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    const value = text;
    setText("");
    await send({ text: value });
  }

  const lastOptions = [...messages].reverse().find((m) => m.direction === "OUTBOUND")?.interactive ?? [];

  return (
    <main style={{ maxWidth: 480, margin: "24px auto", padding: 16, display: "grid", gap: 12 }}>
      <p style={{ background: "#fff3cd", padding: 8, borderRadius: 8, margin: 0 }}><strong>DEVELOPMENT SIMULATOR · NOT WHATSAPP.</strong> Messages here use the same state machine and database as the real channel but are never sent to a phone.</p>
      <label>Simulated patient phone (digits with country code)<input value={phone} onChange={(event) => setPhone(event.target.value.replace(/\D/g, ""))} style={{ width: "100%" }} /></label>
      <div style={{ border: "1px solid #ddd", borderRadius: 12, height: 420, overflowY: "auto", padding: 10, display: "grid", alignContent: "start", gap: 6 }}>
        {messages.map((message) => (
          <div key={message.id} style={{ justifySelf: message.direction === "INBOUND" ? "end" : "start", maxWidth: "85%", whiteSpace: "pre-wrap", background: message.direction === "INBOUND" ? "#dcf8c6" : "#f1f1f1", padding: "6px 10px", borderRadius: 10 }}>
            {message.body}
            {message.sender === "STAFF" && <small style={{ display: "block", opacity: 0.6 }}>reception</small>}
          </div>
        ))}
        <div ref={bottom} />
      </div>
      {lastOptions.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {lastOptions.map((option) => <button key={option.id} className="button button-outline button-small" disabled={busy} onClick={() => send({ text: option.title, optionId: option.id })}>{option.title}{option.description ? ` · ${option.description}` : ""}</button>)}
        </div>
      )}
      <form onSubmit={submit} style={{ display: "flex", gap: 8 }}>
        <input style={{ flex: 1 }} value={text} onChange={(event) => setText(event.target.value)} placeholder="Type as the patient…" aria-label="Message" maxLength={1000} disabled={busy} />
        <button className="button button-primary" disabled={busy}>Send</button>
      </form>
      {error && <p role="alert" style={{ color: "#b00020", margin: 0 }}>{error}</p>}
    </main>
  );
}
