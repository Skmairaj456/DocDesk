"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type DemoCredentials = {
  doctor: string;
  receptionist: string;
  password: string;
};

export default function SignInForm({ demoCredentials }: { demoCredentials: DemoCredentials | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [linkMessage, setLinkMessage] = useState("");
  const [linkError, setLinkError] = useState("");
  const [sending, setSending] = useState(false);
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  function createClient() {
    return createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError("");
    if (!configured) {
      setPasswordError("Supabase Auth is not configured. Copy .env.example to .env and add your project settings.");
      return;
    }

    setSending(true);
    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setPasswordError("Unable to sign in. Check the email and password, then try again.");
      } else {
        router.replace("/");
      }
    } catch (signInError) {
      console.error("Unable to sign in with Supabase", signInError);
      setPasswordError("We couldn’t sign in. Check the Supabase configuration and try again.");
    } finally {
      setSending(false);
    }
  }

  async function submitMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLinkMessage("");
    setLinkError("");
    if (!configured) {
      setLinkError("Supabase Auth is not configured. Copy .env.example to .env and add your project settings.");
      return;
    }

    setSending(true);
    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (signInError) {
        setLinkError(signInError.message);
      } else {
        setLinkMessage("If this email belongs to a clinic member, a secure sign-in link is on its way.");
      }
    } catch (signInError) {
      console.error("Unable to request a Supabase sign-in link", signInError);
      setLinkError("We couldn’t request a sign-in link. Check the Supabase configuration and try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {demoCredentials && (
        <aside className="dialog-note" aria-label="Development demo credentials">
          <span>
            Development demo accounts · Doctor: <strong>{demoCredentials.doctor}</strong> · Receptionist: <strong>{demoCredentials.receptionist}</strong> · Password: <strong>{demoCredentials.password}</strong>
          </span>
          <div className="demo-account-actions">
            <button type="button" className="button button-quiet" onClick={() => { setEmail(demoCredentials.doctor); setPassword(demoCredentials.password); }}>Use doctor</button>
            <button type="button" className="button button-quiet" onClick={() => { setEmail(demoCredentials.receptionist); setPassword(demoCredentials.password); }}>Use receptionist</button>
          </div>
        </aside>
      )}
      <form className="dialog-form" onSubmit={submitPassword}>
        <label htmlFor="sign-in-email">Email address<input id="sign-in-email" autoComplete="username" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@clinic.com" /></label>
        <label htmlFor="sign-in-password">Password<input id="sign-in-password" autoComplete="current-password" type="password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {passwordError && <p className="form-error" role="alert">{passwordError}</p>}
        <button type="submit" className="button button-primary" disabled={sending}>{sending ? "Signing in…" : "Sign in with password"}</button>
        <p className="dialog-note">Access is restricted to invited clinic memberships. A valid Supabase login alone does not grant patient access.</p>
      </form>
      <form className="dialog-form" onSubmit={submitMagicLink}>
        <label htmlFor="magic-link-email">Or use a one-time email link<input id="magic-link-email" autoComplete="email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@clinic.com" /></label>
        {linkError && <p className="form-error" role="alert">{linkError}</p>}
        {linkMessage && <p className="sign-in-success" role="status">{linkMessage}</p>}
        <button type="submit" className="button button-outline" disabled={sending}>{sending ? "Sending secure link…" : "Send sign-in link"}</button>
      </form>
    </>
  );
}
