-- WhatsApp automation: conversation state, durable inbound events, outbox, consent, registration status.

CREATE TYPE "ConversationState" AS ENUM ('IDLE', 'MAIN_MENU', 'ASKING_VISITED', 'CONSENT_REGISTRATION', 'COLLECTING_NAME', 'COLLECTING_DOB', 'COLLECTING_SEX', 'VERIFYING_EXISTING_PATIENT', 'CONFIRMING_DETAILS', 'OFFERING_MESSAGING_CONSENT', 'SELECTING_DEPARTMENT', 'SELECTING_DOCTOR', 'SELECTING_DATE', 'SELECTING_SLOT', 'CONFIRMING_BOOKING', 'MANAGING_APPOINTMENTS', 'CONFIRMING_CANCELLATION', 'CHOOSING_UPDATE_FIELD', 'MANAGING_APPOINTMENT_DETAIL', 'RESUME_PROMPT', 'HUMAN_HANDOVER', 'COMPLETED');
CREATE TYPE "RegistrationStatus" AS ENUM ('INCOMPLETE', 'COMPLETE');
CREATE TYPE "AppointmentSource" AS ENUM ('RECEPTION', 'DOCTOR', 'WHATSAPP');
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED');
CREATE TYPE "MessageSender" AS ENUM ('PATIENT', 'BOT', 'STAFF');
CREATE TYPE "ConsentType" AS ENUM ('REGISTRATION', 'MESSAGING');

ALTER TABLE "Appointment" ADD COLUMN "source" "AppointmentSource" NOT NULL DEFAULT 'RECEPTION';

ALTER TABLE "Patient" ADD COLUMN "registrationStatus" "RegistrationStatus" NOT NULL DEFAULT 'COMPLETE';

ALTER TABLE "WebhookEvent"
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "conversationId" UUID,
  ADD COLUMN "lastError" TEXT,
  ADD COLUMN "nextAttemptAt" TIMESTAMPTZ(3),
  ADD COLUMN "payload" JSONB,
  ADD COLUMN "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED';
-- Events recorded before this migration were already handled by the previous webhook.
UPDATE "WebhookEvent" SET "status" = 'PROCESSED' WHERE "processedAt" IS NOT NULL;

ALTER TABLE "WhatsAppConversation"
  ADD COLUMN "context" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "displayName" TEXT,
  ADD COLUMN "isSimulated" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "messagingConsentAt" TIMESTAMPTZ(3),
  ADD COLUMN "registrationConsentAt" TIMESTAMPTZ(3),
  ADD COLUMN "state" "ConversationState" NOT NULL DEFAULT 'IDLE',
  ADD COLUMN "stateUpdatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "WhatsAppMessage"
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "interactive" JSONB,
  ADD COLUMN "isSimulated" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'REPLY',
  ADD COLUMN "lastError" TEXT,
  ADD COLUMN "lockedAt" TIMESTAMPTZ(3),
  ADD COLUMN "nextAttemptAt" TIMESTAMPTZ(3),
  ADD COLUMN "sender" "MessageSender" NOT NULL DEFAULT 'BOT',
  ADD COLUMN "sentAt" TIMESTAMPTZ(3),
  ADD COLUMN "seq" BIGSERIAL NOT NULL;
UPDATE "WhatsAppMessage" SET "sender" = 'PATIENT' WHERE "direction" = 'INBOUND';

CREATE TABLE "ConsentEvent" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "patientId" UUID,
    "conversationId" UUID NOT NULL,
    "type" "ConsentType" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConsentEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConsentEvent_clinicId_conversationId_createdAt_idx" ON "ConsentEvent"("clinicId", "conversationId", "createdAt");
CREATE INDEX "ConsentEvent_clinicId_patientId_type_createdAt_idx" ON "ConsentEvent"("clinicId", "patientId", "type", "createdAt");
CREATE INDEX "WebhookEvent_conversationId_status_createdAt_idx" ON "WebhookEvent"("conversationId", "status", "createdAt");
CREATE INDEX "WebhookEvent_status_nextAttemptAt_idx" ON "WebhookEvent"("status", "nextAttemptAt");
CREATE UNIQUE INDEX "WhatsAppMessage_idempotencyKey_key" ON "WhatsAppMessage"("idempotencyKey");
CREATE INDEX "WhatsAppMessage_conversationId_seq_idx" ON "WhatsAppMessage"("conversationId", "seq");
CREATE INDEX "WhatsAppMessage_status_nextAttemptAt_idx" ON "WhatsAppMessage"("status", "nextAttemptAt");
CREATE UNIQUE INDEX "WhatsAppConversation_clinicId_id_key" ON "WhatsAppConversation"("clinicId", "id");

ALTER TABLE "ConsentEvent"
  ADD CONSTRAINT "ConsentEvent_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ConsentEvent_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ConsentEvent_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WhatsAppConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ConsentEvent_patient_tenant_fkey" FOREIGN KEY ("clinicId", "patientId") REFERENCES "Patient"("clinicId", "id") ON DELETE NO ACTION ON UPDATE CASCADE,
  ADD CONSTRAINT "ConsentEvent_conversation_tenant_fkey" FOREIGN KEY ("clinicId", "conversationId") REFERENCES "WhatsAppConversation"("clinicId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConsentEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConsentEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ConsentEvent_tenant_policy" ON "ConsentEvent"
  USING ("clinicId"::text = current_setting('app.clinic_id', true) OR current_setting('app.worker', true) = 'true')
  WITH CHECK ("clinicId"::text = current_setting('app.clinic_id', true) OR current_setting('app.worker', true) = 'true');

-- Partial index used by the outbox dispatcher.
CREATE INDEX "WhatsAppMessage_queued_idx" ON "WhatsAppMessage"("conversationId", "seq") WHERE "status" = 'QUEUED';
