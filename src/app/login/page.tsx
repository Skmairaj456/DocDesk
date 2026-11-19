import { Suspense } from "react";
import SignInForm from "@/components/sign-in-form";
import BrandLogo from "@/components/brand-logo";

export const metadata = { title: "Sign in | Practice Up" };

export default function LoginPage() {
  return (
    <main className="setup-screen">
      <section className="setup-card">
        <BrandLogo className="setup-logo" height={52} />
        <p className="eyebrow">SECURE CLINIC ACCESS</p>
        <h1>Sign in to Practice Up</h1>
        <p>Sign in with your clinic account or request a one-time email link.</p>
        <Suspense fallback={<p>Loading sign-in…</p>}>
          <SignInForm
            demoCredentials={process.env.NODE_ENV === "production" ? null : {
              doctor: "saheesta@docdesk.demo",
              receptionist: "reception@docdesk.demo",
              password: "DocDeskDemo!2026",
            }}
          />
        </Suspense>
      </section>
    </main>
  );
}
