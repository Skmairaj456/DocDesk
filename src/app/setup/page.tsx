export const metadata = { title: "Setup | DocDesk" };

export default function SetupPage() {
  return (
    <main className="setup-screen">
      <article className="setup-card setup-guide">
        <span className="brand-mark">d.</span>
        <p className="eyebrow">LOCAL DEVELOPMENT</p>
        <h1>Connect your clinic workspace</h1>
        <p>Production clinic data is never replaced with sample records. Configure a Supabase project to enable authenticated database access.</p>
        <ol>
          <li>Copy <code>.env.example</code> to <code>.env</code>, then set your Supabase Auth project URL and publishable key.</li>
          <li>Set <code>DATABASE_URL</code> to the clinic PostgreSQL database. Keep all database and WhatsApp secrets server-side.</li>
          <li>Run <code>npm run db:migrate</code> and <code>npm run db:seed</code> in a development database.</li>
          <li>Create Supabase Auth users and add matching clinic user/membership records before opening live patient data.</li>
        </ol>
        <p className="dialog-note">The default development dashboard is a non-persistent simulator. Set <code>DOC_DESK_MODE=live</code> in <code>.env</code> to use authenticated clinic data locally. Seeded password accounts are development-only; never use them against production data. The simulator cannot send WhatsApp messages.</p>
        <a className="button button-primary" href="/login">Continue to secure sign-in</a>
      </article>
    </main>
  );
}
