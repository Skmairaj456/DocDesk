# DocDesk

DocDesk is a clinic-operations MVP built with Next.js App Router, TypeScript, Supabase Auth, Prisma, and PostgreSQL. It focuses on a reception schedule, patient contact records, a doctor queue, follow-up tracking, and a clearly labelled WhatsApp development simulator.

> **Pilot status:** this is an early MVP, not a production-ready clinical system. The local simulator uses fictional in-memory records. Live access requires external Supabase and PostgreSQL setup. Complete the security review, privacy/compliance assessment, operational setup, and pilot acceptance testing before using real patient data.

## What works

- Responsive reception calendar/dashboard, patient directory, doctor queue, three-panel WhatsApp simulator, follow-up tracker, and consultation/follow-up prototype based on the supplied wireframes.
- The simulator is explicitly labelled, session-only, uses fictional records, and does not send WhatsApp messages. Production builds do not show the simulator.
- Supabase password and email-magic-link authentication with server-side clinic membership/role checks.
- Live clinic page with scoped patient search/registration, appointment listing, appointment booking, check-in, and doctor status transitions.
- A separate doctor workspace with a visit queue, appointment rescheduling and cancellation, patient demographics/contact details and clinic-wide visit/consultation history, consultation drafts and completion, visit outcomes, follow-up requests, and follow-up appointment booking.
- Doctor consultation and follow-up APIs that enforce assignment, clinic membership, and role permissions on the server.
- Server-side patient/appointment APIs with Zod validation, clinic scoping, audit events, availability checks, and conflict responses.
- PostgreSQL schema and migrations for clinics, memberships, departments, doctor schedules, patients, appointments, holds, consultation notes, follow-ups, WhatsApp conversations/messages, scheduled jobs, audit logs, and webhook event deduplication.
- Transaction-local identity propagation and PostgreSQL RLS policies. A shared exclusion constraint on schedule blocks prevents overlapping appointments/holds per doctor.
- WhatsApp webhook verification and signature validation, message/delivery-state storage, webhook deduplication, and opt-out handling for common STOP keywords. No real messages are sent by the simulator.
- A secret-protected scheduled-job route for appointment-hold expiry and seven-day unbooked-follow-up escalation. Jobs use idempotency keys, row locking, bounded retries, and failure state.
- Fictional development seed data, a guarded development-only doctor/receptionist account provisioner, and a user-linking CLI for additional clinic users.

## Known incomplete work

Do not treat the current build as a complete clinic deployment:

- Admin screens for clinic settings, departments, staff invitations, doctor leave, breaks, schedules, and availability management are not implemented.
- The receptionist workspace still needs appointment rescheduling/cancellation and patient self-service identity verification.
- The receptionist workspace still needs a persistent dashboard, appointment rescheduling/cancellation, and fuller patient-profile editing. The doctor workspace supports basic persisted consultation and follow-up workflows, but is not a substitute for a validated clinical record system.
- WhatsApp inbound webhooks are received and recorded, but the booking/menu bot, outbound Cloud API sender, approved-template handling, consent collection, and human handover actions are not implemented. No outbound WhatsApp send is claimed.
- The job runner currently handles hold expiry and unbooked-follow-up escalation. Appointment reminders, follow-up invitations, and transient WhatsApp delivery retries are not yet scheduled/sent.
- The webhook is configured for one clinic phone-number ID via environment variables. Multi-clinic WhatsApp account routing is not implemented.
- Demo accounts are created in Supabase Auth only when `npm run db:demo-users` is run with the development service-role key. They are not created by the normal seed command and the provisioner refuses to run in production.
- Database-backed API role-enforcement, concurrent-booking, webhook persistence, and job-retry tests still need to be added. An opt-in PostgreSQL integration test now checks runtime-role privileges plus cross-clinic patient and consultation read/write isolation.
- Production backups, recovery drills, monitoring/alerts, rate limiting, retention policy, audit-log review, encryption/key rotation, and regulatory compliance remain deployment responsibilities.

## Requirements

- Node.js 20.9 or later and npm
- A Supabase project for Auth and PostgreSQL for persisted clinic data
- A PostgreSQL migration connection with permission to create the required schema/extension
- Optional: Meta WhatsApp Business Platform credentials for later integration work

## Local development

In PowerShell:

```powershell
Copy-Item .env.example .env
npm ci
npm run db:generate
npm run db:dev
npm run db:seed
npm run dev
```

Open `http://localhost:3000`. Without production credentials the page runs in the development simulator. Its records are fictional and its changes are held only in client memory.

To exercise the authenticated database-backed workspace locally, set `DOC_DESK_MODE=live` in `.env`, configure the Supabase Auth and PostgreSQL variables below, and restart the dev server. The app then uses the same sign-in, clinic membership, role checks, and database path as production; it does not fall back to simulator data if setup or database access fails. Remove the setting or use `DOC_DESK_MODE=simulator` to return to the fictional simulator. Production always uses the live path regardless of this development setting.

`npm run db:dev` applies migrations without resetting existing data. Do not use `prisma migrate reset` against a database containing clinic data. For a shared/production database, review the migration SQL and run:

```powershell
npm run db:migrate
```

`npm run db:seed` is for a disposable development database only. It is idempotent and inserts fictional people, sample availability, and sample appointments. It does not create Supabase Auth accounts.

### Development demo logins

After applying the schema and seeding a **disposable development Supabase project**, add its server-only service-role key to `.env` as `SUPABASE_SERVICE_ROLE_KEY`, set `DOC_DESK_MODE=live`, then run:

```powershell
npm run db:seed
npm run db:demo-users
npm run dev
```

The login page displays these credentials in development only:

| Role | Email | Password |
| --- | --- | --- |
| Receptionist | `reception@docdesk.demo` | `DocDeskDemo!2026` |
| Doctor (Dr. Aditi Rao, Cardiology) | `doctor@docdesk.demo` | `DocDeskDemo!2026` |
| Doctor (Dr. Neel Shah, Dermatology) | `neel@docdesk.demo` | `DocDeskDemo!2026` |
| Doctor (Dr. Sana Ali, General) | `sana@docdesk.demo` | `DocDeskDemo!2026` |

The provisioner creates confirmed Supabase Auth users and links them to the seeded clinic roles. It refuses to overwrite an existing Auth account unless that account was previously created as a DocDesk demo user, and it refuses to run when `NODE_ENV=production`. Never use the service-role key or demo accounts with production data; keep the service-role key server-side and out of source control. The regular email magic-link option remains available.

## Environment variables

Copy `.env.example` to `.env`. Keep `.env` out of source control.

| Variable | Purpose |
| --- | --- |
| `DOC_DESK_MODE` | Set to `live` to use authenticated database-backed data during local development; defaults to `simulator`. Production always uses the live path. |
| `DATABASE_URL` | Runtime PostgreSQL connection. In production, use a dedicated non-owner role without `BYPASSRLS`. |
| `MIGRATION_DATABASE_URL` | Optional elevated migration connection. Defaults to `DATABASE_URL` for local development. |
| `DOC_DESK_TEST_DATABASE_URL` | Optional URL for database isolation tests. Must point to a local loopback PostgreSQL database whose name ends in `_test` or `-test`; it must use the same restricted role as the application. |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase publishable/anon key; the only Supabase key intended for browser use. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key required only for local demo-account provisioning. Never use a production service-role key for this. |
| `WHATSAPP_APP_SECRET` | Server-only Meta app secret used to verify webhook signatures. |
| `WHATSAPP_VERIFY_TOKEN` | Server-only token used during webhook URL verification. |
| `WHATSAPP_PHONE_NUMBER_ID` | Server-only phone-number ID accepted by this single-clinic webhook. |
| `WHATSAPP_CLINIC_ID` | Clinic UUID associated with that phone number. |
| `WHATSAPP_ACCESS_TOKEN` | Reserved server-only integration secret; outbound sending is not implemented. |
| `CRON_SECRET` | Long random bearer secret for `POST /api/jobs/run`. |

Never put database credentials, the WhatsApp app secret/access token, or a service-role key in a `NEXT_PUBLIC_` variable. The runtime app does not require a service-role key; only the explicit local demo-account provisioner uses it.

## Supabase Auth and clinic membership

1. Add the local and deployed origins to Supabase Auth's allowed redirect URLs. Configure email OTP/magic-link delivery.
2. Create an Auth user through the Supabase dashboard or a trusted invitation process.
3. Copy that Auth user's UUID and existing clinic UUID, then set the variables below in the local shell and run `npm run user:link`:

```powershell
$env:SUPABASE_AUTH_SUBJECT = "SUPABASE-AUTH-USER-UUID"
$env:USER_EMAIL = "doctor@example.test"
$env:USER_NAME = "Dr. Example"
$env:CLINIC_ID = "CLINIC-UUID"
$env:CLINIC_ROLE = "DOCTOR"
$env:DOCTOR_DEPARTMENT_IDS = "DEPARTMENT-UUID"
npm run user:link
```

For a receptionist or admin, use `RECEPTIONIST` or `ADMIN` and omit `DOCTOR_DEPARTMENT_IDS`. The account must first exist in Supabase Auth; a successful magic-link sign-in without a matching active clinic membership does not grant access.

### RLS and runtime database role

Prisma does not automatically forward the authenticated Supabase identity to PostgreSQL. Protected data access uses a transaction and sets `app.auth_subject`, `app.user_id`, and `app.clinic_id` with parameterized `set_config(..., true)` calls. The RLS migration applies `FORCE ROW LEVEL SECURITY` and uses those transaction-local settings. The scheduled worker sets a separate `app.worker` setting only after checking `CRON_SECRET`.

The runtime connection must not be the table owner, a superuser, or a role with `BYPASSRLS`; those roles can bypass row-level policies. Use an elevated, separately held connection for migrations and a least-privilege runtime login. After creating the schema, provision a runtime role in the database administration console and grant it the required schema/table/sequence permissions, for example:

```sql
CREATE ROLE docdesk_runtime LOGIN PASSWORD 'REPLACE_WITH_A_RANDOM_SECRET'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO docdesk_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO docdesk_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO docdesk_runtime;
```

Set `DATABASE_URL` to this restricted runtime login and `MIGRATION_DATABASE_URL` to a separately controlled migration connection. Confirm the actual role attributes and RLS behaviour against the target Supabase project; do not assume a default `postgres` connection is restricted.

Verify the active runtime login in the database console. It must not be a superuser, have `BYPASSRLS`, or own any RLS-protected table:

```sql
SELECT role.rolname, role.rolsuper, role.rolbypassrls,
  EXISTS (
    SELECT 1
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relrowsecurity
      AND relation.relowner = role.oid
  ) AS owns_rls_tables
FROM pg_roles role
WHERE role.rolname = current_user;
```

Review inherited role memberships as well; the runtime login must not be able to assume a privileged migration/table-owner role. Keep the migration credential separate and unavailable to the running web application.

## WhatsApp webhook

Configure Meta's callback URL as `https://YOUR_HOST/api/whatsapp/webhook` and use the value of `WHATSAPP_VERIFY_TOKEN` for verification. Set the app secret, phone-number ID, and clinic UUID on the server. `GET` verifies the challenge; `POST` validates `X-Hub-Signature-256`, checks the configured phone-number ID, deduplicates message/status events, and records inbound messages and delivery states.

The webhook stores each event, deduplicates by Meta's message id, and then runs the conversation engine (`src/lib/whatsapp/`). It handles text and button/list replies, replies through a durable outbox, and hands over to reception when asked or after repeated failures. Registration and messaging consent are recorded separately in `ConsentEvent`.

**Status: the engine, outbox and webhook are tested only against the simulator and a local PostgreSQL. Sending to real WhatsApp has not been tested.** Until `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` are set, all outbound messages are marked as simulated. Reminders, approved templates for messages outside the 24-hour window, and media messages are not implemented (out-of-window sends are marked failed with `WINDOW_CLOSED`).

### Simulator

Sign in as reception or admin and open `/simulator`. It uses the same engine and database as the real channel and never contacts a phone. In production it is hidden unless `DOC_DESK_SIMULATOR=enabled` is set. Staff see the conversations in the WhatsApp tab of the workspace, where they can take over, reply, return to the bot, and assign.

New patients are created from the simulator or WhatsApp as `INCOMPLETE` and become `COMPLETE` only after the patient confirms their details. Existing patients are verified by phone number plus date of birth; phone possession alone is never treated as proof of identity.

## Scheduled processing

Run `POST /api/jobs/run` (or `GET`, for Vercel cron) from a trusted scheduler with the header `Authorization: Bearer <CRON_SECRET>`. Each run enqueues expiry/escalation jobs, claims due rows with `FOR UPDATE SKIP LOCKED`, retries stored but unprocessed WhatsApp events, and dispatches the outbox. Repeated calls are idempotent. Vercel Hobby cron runs at most daily; webhook and simulator requests process their events immediately, and the cron only provides recovery.

## Validation and tests

```powershell
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run build
```

`npm run test:integration` starts a disposable PostgreSQL (the `embedded-postgres` dev dependency), applies every migration, runs `integration/whatsapp.spec.ts`, and deletes the database. It covers registration and booking end to end, duplicate deliveries, parallel messages, identity verification, handover versus queued replies, opt-out, patient cancellation and two patients racing for one slot. It runs as a superuser, so it does not exercise row-level security; use `test:db` for that.

`npm test` runs the unit tests and skips the database integration test unless `DOC_DESK_TEST_DATABASE_URL` is set. To run it, provision a disposable local PostgreSQL database named `docdesk_test`, apply the migrations using the elevated migration login, and configure the test URL to use a restricted non-owner runtime role with the same grants as the application:

```powershell
$env:DOC_DESK_TEST_DATABASE_URL = "postgresql://docdesk_runtime:REPLACE_ME@localhost:5432/docdesk_test?schema=public"
npm run test:db
```

The test rejects non-loopback hosts and database names that do not end in `_test` or `-test`, creates only fictional records, and rolls them back in a transaction. It checks that the runtime role is not superuser, does not have `BYPASSRLS`, does not own RLS-protected tables, and cannot read or modify another clinic's patients or consultation notes. It does not test HTTP/API role authorization or prove the safety of any remote deployment.

## Deployment, backup, recovery, and monitoring

1. Configure separate runtime and migration secrets in the deployment environment; never commit `.env`.
2. Apply migrations through a reviewed deployment step. Do not reset a production database.
3. Use HTTPS, configure Supabase Auth redirect URLs, and set the webhook and cron secrets only in server-side settings.
4. Configure automated PostgreSQL backups/PITR according to the clinic's retention requirements. Document restore ownership and perform periodic restore drills into an isolated environment.
5. Monitor application errors, database connectivity/pool saturation, migration state, scheduled-job backlog/failures, webhook validation failures, and WhatsApp delivery failures. Alert an operator; do not log message bodies or clinical note content.
6. Complete a security/privacy review, access-control test, data-retention decision, clinic staff training, and real-clinic acceptance testing before importing patient data.
