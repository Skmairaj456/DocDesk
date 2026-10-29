CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE UNIQUE INDEX "Membership_clinicId_id_key" ON "Membership"("clinicId", "id");
CREATE UNIQUE INDEX "Department_clinicId_id_key" ON "Department"("clinicId", "id");
CREATE UNIQUE INDEX "DoctorProfile_clinicId_id_key" ON "DoctorProfile"("clinicId", "id");
CREATE UNIQUE INDEX "Patient_clinicId_id_key" ON "Patient"("clinicId", "id");
CREATE UNIQUE INDEX "Appointment_clinicId_id_key" ON "Appointment"("clinicId", "id");
CREATE UNIQUE INDEX "AppointmentHold_clinicId_id_key" ON "AppointmentHold"("clinicId", "id");

ALTER TABLE "DoctorProfile"
  ADD CONSTRAINT "DoctorProfile_membership_tenant_fkey"
  FOREIGN KEY ("clinicId", "membershipId") REFERENCES "Membership"("clinicId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_patient_tenant_fkey"
  FOREIGN KEY ("clinicId", "patientId") REFERENCES "Patient"("clinicId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Appointment_department_tenant_fkey"
  FOREIGN KEY ("clinicId", "departmentId") REFERENCES "Department"("clinicId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Appointment_doctor_tenant_fkey"
  FOREIGN KEY ("clinicId", "doctorId") REFERENCES "DoctorProfile"("clinicId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AppointmentHold"
  ADD CONSTRAINT "AppointmentHold_doctor_tenant_fkey"
  FOREIGN KEY ("clinicId", "doctorId") REFERENCES "DoctorProfile"("clinicId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AppointmentHold_patient_tenant_fkey"
  FOREIGN KEY ("clinicId", "patientId") REFERENCES "Patient"("clinicId", "id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "ScheduleBlock"
  ADD CONSTRAINT "ScheduleBlock_doctor_tenant_fkey"
  FOREIGN KEY ("clinicId", "doctorId") REFERENCES "DoctorProfile"("clinicId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ScheduleBlock_appointment_tenant_fkey"
  FOREIGN KEY ("clinicId", "appointmentId") REFERENCES "Appointment"("clinicId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ScheduleBlock_hold_tenant_fkey"
  FOREIGN KEY ("clinicId", "holdId") REFERENCES "AppointmentHold"("clinicId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ScheduleBlock_valid_source_check"
  CHECK (num_nonnulls("appointmentId", "holdId") = 1),
  ADD CONSTRAINT "ScheduleBlock_valid_time_check"
  CHECK ("endsAt" > "startsAt"),
  ADD CONSTRAINT "ScheduleBlock_doctor_time_excl"
  EXCLUDE USING gist (
    "doctorId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  );

ALTER TABLE "Consultation"
  ADD CONSTRAINT "Consultation_appointment_tenant_fkey"
  FOREIGN KEY ("clinicId", "appointmentId") REFERENCES "Appointment"("clinicId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Consultation_patient_tenant_fkey"
  FOREIGN KEY ("clinicId", "patientId") REFERENCES "Patient"("clinicId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Consultation_doctor_tenant_fkey"
  FOREIGN KEY ("clinicId", "doctorId") REFERENCES "DoctorProfile"("clinicId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FollowUp"
  ADD CONSTRAINT "FollowUp_patient_tenant_fkey"
  FOREIGN KEY ("clinicId", "patientId") REFERENCES "Patient"("clinicId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FollowUp_department_tenant_fkey"
  FOREIGN KEY ("clinicId", "departmentId") REFERENCES "Department"("clinicId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FollowUp_doctor_tenant_fkey"
  FOREIGN KEY ("clinicId", "responsibleDoctorId") REFERENCES "DoctorProfile"("clinicId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FollowUp_booked_appointment_tenant_fkey"
  FOREIGN KEY ("clinicId", "bookedAppointmentId") REFERENCES "Appointment"("clinicId", "id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "WhatsAppConversation"
  ADD CONSTRAINT "WhatsAppConversation_patient_tenant_fkey"
  FOREIGN KEY ("clinicId", "patientId") REFERENCES "Patient"("clinicId", "id")
  ON DELETE NO ACTION ON UPDATE CASCADE,
  ADD CONSTRAINT "WhatsAppConversation_membership_tenant_fkey"
  FOREIGN KEY ("clinicId", "assignedMembershipId") REFERENCES "Membership"("clinicId", "id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "Clinic" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Clinic" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Clinic_tenant_policy" ON "Clinic"
  USING ("id"::text = current_setting('app.clinic_id', true) OR current_setting('app.worker', true) = 'true')
  WITH CHECK ("id"::text = current_setting('app.clinic_id', true) OR current_setting('app.worker', true) = 'true');

ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Membership" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Membership_tenant_policy" ON "Membership"
  USING (
    "clinicId"::text = current_setting('app.clinic_id', true)
    OR "userId"::text = current_setting('app.user_id', true)
    OR current_setting('app.worker', true) = 'true'
  )
  WITH CHECK (
    "clinicId"::text = current_setting('app.clinic_id', true)
    OR current_setting('app.worker', true) = 'true'
  );

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" FORCE ROW LEVEL SECURITY;
CREATE POLICY "User_tenant_policy" ON "User"
  USING (
    "authSubject"::text = current_setting('app.auth_subject', true)
    OR EXISTS (
      SELECT 1 FROM "Membership" membership
      WHERE membership."userId" = "User"."id"
        AND membership."clinicId"::text = current_setting('app.clinic_id', true)
    )
    OR current_setting('app.worker', true) = 'true'
  )
  WITH CHECK (
    "authSubject"::text = current_setting('app.auth_subject', true)
    OR current_setting('app.worker', true) = 'true'
  );

ALTER TABLE "Department" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Department" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Department_tenant_policy" ON "Department"
  USING ("clinicId"::text = current_setting('app.clinic_id', true) OR current_setting('app.worker', true) = 'true')
  WITH CHECK ("clinicId"::text = current_setting('app.clinic_id', true) OR current_setting('app.worker', true) = 'true');

ALTER TABLE "DoctorProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DoctorProfile" FORCE ROW LEVEL SECURITY;
CREATE POLICY "DoctorProfile_tenant_policy" ON "DoctorProfile"
  USING ("clinicId"::text = current_setting('app.clinic_id', true) OR current_setting('app.worker', true) = 'true')
  WITH CHECK ("clinicId"::text = current_setting('app.clinic_id', true) OR current_setting('app.worker', true) = 'true');

ALTER TABLE "DoctorDepartment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DoctorDepartment" FORCE ROW LEVEL SECURITY;
CREATE POLICY "DoctorDepartment_tenant_policy" ON "DoctorDepartment"
  USING (
    EXISTS (
      SELECT 1 FROM "DoctorProfile" doctor
      WHERE doctor."id" = "DoctorDepartment"."doctorId"
        AND doctor."clinicId"::text = current_setting('app.clinic_id', true)
    )
    OR current_setting('app.worker', true) = 'true'
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "DoctorProfile" doctor
      WHERE doctor."id" = "DoctorDepartment"."doctorId"
        AND doctor."clinicId"::text = current_setting('app.clinic_id', true)
    )
    OR current_setting('app.worker', true) = 'true'
  );

ALTER TABLE "Patient" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Patient" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Patient_tenant_policy" ON "Patient"
  USING ("clinicId"::text = current_setting('app.clinic_id', true) OR current_setting('app.worker', true) = 'true')
  WITH CHECK ("clinicId"::text = current_setting('app.clinic_id', true) OR current_setting('app.worker', true) = 'true');

ALTER TABLE "Appointment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Appointment" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Appointment_tenant_policy" ON "Appointment"
  USING ("clinicId"::text = current_setting('app.clinic_id', true) OR current_setting('app.worker', true) = 'true')
  WITH CHECK ("clinicId"::text = current_setting('app.clinic_id', true) OR current_setting('app.worker', true) = 'true');

ALTER TABLE "AppointmentHold" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AppointmentHold" FORCE ROW LEVEL SECURITY;
CREATE POLICY "AppointmentHold_tenant_policy" ON "AppointmentHold"
  USING ("clinicId"::text = current_setting('app.clinic_id', true) OR current_setting('app.worker', true) = 'true')
  WITH CHECK ("clinicId"::text = current_setting('app.clinic_id', true) OR current_setting('app.worker', true) = 'true');

ALTER TABLE "ScheduleBlock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScheduleBlock" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ScheduleBlock_tenant_policy" ON "ScheduleBlock"
  USING ("clinicId"::text = current_setting('app.clinic_id', true) OR current_setting('app.worker', true) = 'true')
  WITH CHECK ("clinicId"::text = current_setting('app.clinic_id', true) OR current_setting('app.worker', true) = 'true');

ALTER TABLE "DoctorAvailability" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DoctorAvailability" FORCE ROW LEVEL SECURITY;
CREATE POLICY "DoctorAvailability_tenant_policy" ON "DoctorAvailability"
  USING (
    EXISTS (
      SELECT 1 FROM "DoctorProfile" doctor
      WHERE doctor."id" = "DoctorAvailability"."doctorId"
        AND doctor."clinicId"::text = current_setting('app.clinic_id', true)
    )
    OR current_setting('app.worker', true) = 'true'
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "DoctorProfile" doctor
      WHERE doctor."id" = "DoctorAvailability"."doctorId"
        AND doctor."clinicId"::text = current_setting('app.clinic_id', true)
    )
    OR current_setting('app.worker', true) = 'true'
  );

ALTER TABLE "AvailabilityException" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AvailabilityException" FORCE ROW LEVEL SECURITY;
CREATE POLICY "AvailabilityException_tenant_policy" ON "AvailabilityException"
  USING (
    EXISTS (
      SELECT 1 FROM "DoctorProfile" doctor
      WHERE doctor."id" = "AvailabilityException"."doctorId"
        AND doctor."clinicId"::text = current_setting('app.clinic_id', true)
    )
    OR current_setting('app.worker', true) = 'true'
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "DoctorProfile" doctor
      WHERE doctor."id" = "AvailabilityException"."doctorId"
        AND doctor."clinicId"::text = current_setting('app.clinic_id', true)
    )
    OR current_setting('app.worker', true) = 'true'
  );

ALTER TABLE "Consultation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Consultation" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Consultation_tenant_policy" ON "Consultation"
  USING ("clinicId"::text = current_setting('app.clinic_id', true) OR current_setting('app.worker', true) = 'true')
  WITH CHECK ("clinicId"::text = current_setting('app.clinic_id', true) OR current_setting('app.worker', true) = 'true');

ALTER TABLE "FollowUp" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FollowUp" FORCE ROW LEVEL SECURITY;
CREATE POLICY "FollowUp_tenant_policy" ON "FollowUp"
  USING ("clinicId"::text = current_setting('app.clinic_id', true) OR current_setting('app.worker', true) = 'true')
  WITH CHECK ("clinicId"::text = current_setting('app.clinic_id', true) OR current_setting('app.worker', true) = 'true');

ALTER TABLE "WhatsAppConversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WhatsAppConversation" FORCE ROW LEVEL SECURITY;
CREATE POLICY "WhatsAppConversation_tenant_policy" ON "WhatsAppConversation"
  USING ("clinicId"::text = current_setting('app.clinic_id', true) OR current_setting('app.worker', true) = 'true')
  WITH CHECK ("clinicId"::text = current_setting('app.clinic_id', true) OR current_setting('app.worker', true) = 'true');

ALTER TABLE "WhatsAppMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WhatsAppMessage" FORCE ROW LEVEL SECURITY;
CREATE POLICY "WhatsAppMessage_tenant_policy" ON "WhatsAppMessage"
  USING (
    EXISTS (
      SELECT 1 FROM "WhatsAppConversation" conversation
      WHERE conversation."id" = "WhatsAppMessage"."conversationId"
        AND conversation."clinicId"::text = current_setting('app.clinic_id', true)
    )
    OR current_setting('app.worker', true) = 'true'
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "WhatsAppConversation" conversation
      WHERE conversation."id" = "WhatsAppMessage"."conversationId"
        AND conversation."clinicId"::text = current_setting('app.clinic_id', true)
    )
    OR current_setting('app.worker', true) = 'true'
  );

ALTER TABLE "ScheduledJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScheduledJob" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ScheduledJob_tenant_policy" ON "ScheduledJob"
  USING ("clinicId"::text = current_setting('app.clinic_id', true) OR current_setting('app.worker', true) = 'true')
  WITH CHECK ("clinicId"::text = current_setting('app.clinic_id', true) OR current_setting('app.worker', true) = 'true');

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY "AuditLog_tenant_policy" ON "AuditLog"
  USING ("clinicId"::text = current_setting('app.clinic_id', true) OR current_setting('app.worker', true) = 'true')
  WITH CHECK ("clinicId"::text = current_setting('app.clinic_id', true) OR current_setting('app.worker', true) = 'true');

ALTER TABLE "WebhookEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WebhookEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY "WebhookEvent_tenant_policy" ON "WebhookEvent"
  USING ("clinicId"::text = current_setting('app.clinic_id', true) OR current_setting('app.worker', true) = 'true')
  WITH CHECK ("clinicId"::text = current_setting('app.clinic_id', true) OR current_setting('app.worker', true) = 'true');
