-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ClinicRole" AS ENUM ('ADMIN', 'RECEPTIONIST', 'DOCTOR');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('BOOKED', 'ARRIVED', 'IN_CONSULTATION', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VisitType" AS ENUM ('CONSULTATION', 'FOLLOW_UP', 'REVISION', 'WALK_IN');

-- CreateEnum
CREATE TYPE "VisitOutcome" AS ENUM ('STABLE', 'IMPROVING', 'REFERRED', 'DISCHARGED');

-- CreateEnum
CREATE TYPE "FollowUpType" AS ENUM ('FOLLOW_UP', 'REVISION');

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('OPEN', 'BOOKED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HoldStatus" AS ENUM ('ACTIVE', 'CONFIRMED', 'EXPIRED', 'RELEASED');

-- CreateEnum
CREATE TYPE "ConversationMode" AS ENUM ('BOT', 'HUMAN');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('RECEIVED', 'QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "ScheduledJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "Clinic" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "phone" TEXT,
    "address" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Clinic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "authSubject" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "ClinicRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoctorProfile" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "consultationMinutes" INTEGER NOT NULL DEFAULT 30,
    "canManageAvailability" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DoctorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoctorDepartment" (
    "doctorId" UUID NOT NULL,
    "departmentId" UUID NOT NULL,

    CONSTRAINT "DoctorDepartment_pkey" PRIMARY KEY ("doctorId","departmentId")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "normalizedPhone" TEXT NOT NULL,
    "dateOfBirth" DATE,
    "sex" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "patientId" UUID NOT NULL,
    "departmentId" UUID NOT NULL,
    "doctorId" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'BOOKED',
    "visitType" "VisitType" NOT NULL DEFAULT 'CONSULTATION',
    "checkedInAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentHold" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "patientId" UUID,
    "doctorId" UUID NOT NULL,
    "departmentId" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "HoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appointmentId" UUID,

    CONSTRAINT "AppointmentHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleBlock" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "doctorId" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "appointmentId" UUID,
    "holdId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoctorAvailability" (
    "id" UUID NOT NULL,
    "doctorId" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startsAt" TEXT NOT NULL,
    "endsAt" TEXT NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DoctorAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityException" (
    "id" UUID NOT NULL,
    "doctorId" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT,
    "isAvailable" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AvailabilityException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consultation" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "appointmentId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "doctorId" UUID NOT NULL,
    "note" TEXT NOT NULL,
    "outcome" "VisitOutcome",
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Consultation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUp" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "consultationId" UUID,
    "patientId" UUID NOT NULL,
    "departmentId" UUID NOT NULL,
    "responsibleDoctorId" UUID NOT NULL,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "type" "FollowUpType" NOT NULL,
    "reasonInternal" TEXT NOT NULL,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'OPEN',
    "bookedAppointmentId" UUID,
    "invitedAt" TIMESTAMPTZ(3),
    "escalatedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppConversation" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "patientId" UUID,
    "phone" TEXT NOT NULL,
    "mode" "ConversationMode" NOT NULL DEFAULT 'BOT',
    "assignedMembershipId" UUID,
    "lastMessageAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WhatsAppConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppMessage" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "body" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL,
    "externalId" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledJob" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "runAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "ScheduledJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lockedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ScheduledJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "userId" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "externalEventKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "processedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_authSubject_key" ON "User"("authSubject");

-- CreateIndex
CREATE INDEX "Membership_userId_isActive_idx" ON "Membership"("userId", "isActive");

-- CreateIndex
CREATE INDEX "Membership_clinicId_role_idx" ON "Membership"("clinicId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_clinicId_userId_key" ON "Membership"("clinicId", "userId");

-- CreateIndex
CREATE INDEX "Department_clinicId_isActive_idx" ON "Department"("clinicId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Department_clinicId_name_key" ON "Department"("clinicId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "DoctorProfile_membershipId_key" ON "DoctorProfile"("membershipId");

-- CreateIndex
CREATE INDEX "DoctorProfile_clinicId_idx" ON "DoctorProfile"("clinicId");

-- CreateIndex
CREATE INDEX "DoctorDepartment_departmentId_idx" ON "DoctorDepartment"("departmentId");

-- CreateIndex
CREATE INDEX "Patient_clinicId_normalizedName_idx" ON "Patient"("clinicId", "normalizedName");

-- CreateIndex
CREATE INDEX "Patient_clinicId_normalizedPhone_idx" ON "Patient"("clinicId", "normalizedPhone");

-- CreateIndex
CREATE INDEX "Patient_clinicId_createdAt_idx" ON "Patient"("clinicId", "createdAt");

-- CreateIndex
CREATE INDEX "Appointment_clinicId_startsAt_status_idx" ON "Appointment"("clinicId", "startsAt", "status");

-- CreateIndex
CREATE INDEX "Appointment_clinicId_doctorId_startsAt_idx" ON "Appointment"("clinicId", "doctorId", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_clinicId_patientId_startsAt_idx" ON "Appointment"("clinicId", "patientId", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_clinicId_departmentId_startsAt_idx" ON "Appointment"("clinicId", "departmentId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_clinicId_reference_key" ON "Appointment"("clinicId", "reference");

-- CreateIndex
CREATE INDEX "AppointmentHold_clinicId_expiresAt_status_idx" ON "AppointmentHold"("clinicId", "expiresAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleBlock_appointmentId_key" ON "ScheduleBlock"("appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleBlock_holdId_key" ON "ScheduleBlock"("holdId");

-- CreateIndex
CREATE INDEX "ScheduleBlock_clinicId_doctorId_startsAt_idx" ON "ScheduleBlock"("clinicId", "doctorId", "startsAt");

-- CreateIndex
CREATE INDEX "DoctorAvailability_doctorId_weekday_isAvailable_idx" ON "DoctorAvailability"("doctorId", "weekday", "isAvailable");

-- CreateIndex
CREATE UNIQUE INDEX "DoctorAvailability_doctorId_weekday_startsAt_key" ON "DoctorAvailability"("doctorId", "weekday", "startsAt");

-- CreateIndex
CREATE INDEX "AvailabilityException_doctorId_startsAt_endsAt_idx" ON "AvailabilityException"("doctorId", "startsAt", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Consultation_appointmentId_key" ON "Consultation"("appointmentId");

-- CreateIndex
CREATE INDEX "Consultation_clinicId_patientId_createdAt_idx" ON "Consultation"("clinicId", "patientId", "createdAt");

-- CreateIndex
CREATE INDEX "Consultation_clinicId_doctorId_createdAt_idx" ON "Consultation"("clinicId", "doctorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FollowUp_consultationId_key" ON "FollowUp"("consultationId");

-- CreateIndex
CREATE UNIQUE INDEX "FollowUp_bookedAppointmentId_key" ON "FollowUp"("bookedAppointmentId");

-- CreateIndex
CREATE INDEX "FollowUp_clinicId_status_dueAt_idx" ON "FollowUp"("clinicId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "FollowUp_clinicId_patientId_dueAt_idx" ON "FollowUp"("clinicId", "patientId", "dueAt");

-- CreateIndex
CREATE INDEX "WhatsAppConversation_clinicId_mode_lastMessageAt_idx" ON "WhatsAppConversation"("clinicId", "mode", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppConversation_clinicId_phone_key" ON "WhatsAppConversation"("clinicId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMessage_externalId_key" ON "WhatsAppMessage"("externalId");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_conversationId_createdAt_idx" ON "WhatsAppMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_status_createdAt_idx" ON "WhatsAppMessage"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledJob_idempotencyKey_key" ON "ScheduledJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ScheduledJob_status_runAt_idx" ON "ScheduledJob"("status", "runAt");

-- CreateIndex
CREATE INDEX "ScheduledJob_clinicId_status_runAt_idx" ON "ScheduledJob"("clinicId", "status", "runAt");

-- CreateIndex
CREATE INDEX "AuditLog_clinicId_createdAt_idx" ON "AuditLog"("clinicId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_clinicId_entity_entityId_idx" ON "AuditLog"("clinicId", "entity", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_externalEventKey_key" ON "WebhookEvent"("externalEventKey");

-- CreateIndex
CREATE INDEX "WebhookEvent_clinicId_createdAt_idx" ON "WebhookEvent"("clinicId", "createdAt");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorProfile" ADD CONSTRAINT "DoctorProfile_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorProfile" ADD CONSTRAINT "DoctorProfile_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorDepartment" ADD CONSTRAINT "DoctorDepartment_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "DoctorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorDepartment" ADD CONSTRAINT "DoctorDepartment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "DoctorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentHold" ADD CONSTRAINT "AppointmentHold_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentHold" ADD CONSTRAINT "AppointmentHold_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "DoctorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentHold" ADD CONSTRAINT "AppointmentHold_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentHold" ADD CONSTRAINT "AppointmentHold_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleBlock" ADD CONSTRAINT "ScheduleBlock_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleBlock" ADD CONSTRAINT "ScheduleBlock_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "DoctorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleBlock" ADD CONSTRAINT "ScheduleBlock_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleBlock" ADD CONSTRAINT "ScheduleBlock_holdId_fkey" FOREIGN KEY ("holdId") REFERENCES "AppointmentHold"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorAvailability" ADD CONSTRAINT "DoctorAvailability_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "DoctorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityException" ADD CONSTRAINT "AvailabilityException_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "DoctorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "DoctorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_responsibleDoctorId_fkey" FOREIGN KEY ("responsibleDoctorId") REFERENCES "DoctorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_bookedAppointmentId_fkey" FOREIGN KEY ("bookedAppointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_assignedMembershipId_fkey" FOREIGN KEY ("assignedMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WhatsAppConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledJob" ADD CONSTRAINT "ScheduledJob_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
