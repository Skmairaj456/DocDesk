import {
  AppointmentSource,
  AppointmentStatus,
  ConsentType,
  ConversationMode,
  ConversationState as S,
  MessageSender,
  MessageStatus,
  Prisma,
  RegistrationStatus,
} from "@prisma/client";
import { clinicLocalDate } from "@/lib/booking-time.mjs";
import {
  BOOKING_HORIZON_DAYS,
  HOLD_MINUTES,
  cancelAppointment,
  confirmHold,
  createHold,
  listDepartmentsWithDoctors,
  listDoctors,
  loadSchedulePool,
  releaseHold,
  slotsForDate,
  type Tx,
} from "@/lib/booking-service";
import { addDays, firstName, formatClinicDate, formatClinicTime, formatDobForDisplay, normalizePhone, parseDateOfBirth, parseName } from "@/lib/whatsapp/text";

export type Option = { id: string; title: string; description?: string };
export type Reply = { body: string; options?: Option[]; kind?: string };
export type Input = { text: string; optionId?: string };

const SESSION_MINUTES = 30;
const MAX_INVALID = 3;
const MAX_VERIFY_ATTEMPTS = 3;
const OPT_OUT_WORDS = new Set(["stop", "unsubscribe", "quit"]);
const MENU_WORDS = new Set(["menu", "main menu", "restart", "start over", "home"]);
const HUMAN_WORDS = new Set(["reception", "human", "agent", "talk to reception", "talk to a person"]);

type SlotChoice = { doctorId: string; doctorName: string; startsAt: string; endsAt: string };

export type ConvData = {
  stack: S[];
  next?: "book" | "manage" | "update";
  flow?: "register" | "update" | "edit-confirm";
  sexAnswered?: boolean;
  verifyAttempts?: number;
  invalid?: number;
  departmentId?: string;
  departmentName?: string;
  doctorId?: string;
  doctorName?: string;
  date?: string;
  slot?: SlotChoice;
  holdId?: string;
  appointmentId?: string;
  resumeState?: S;
  resumeReason?: "expired" | "stuck";
  options?: Option[];
};

type Ctx = {
  tx: Tx;
  clinic: { id: string; name: string; timezone: string; phone: string | null; address: string | null };
  conversationId: string;
  stateUpdatedAt: Date;
  phone: string;
  now: Date;
  state: S;
  mode: ConversationMode;
  patientId: string | null;
  optedOutAt: Date | null;
  registrationConsentAt: Date | null;
  messagingConsentAt: Date | null;
  data: ConvData;
  replies: Reply[];
  audits: Prisma.AuditLogCreateManyInput[];
};

export type EngineResult = { replies: number; state: S };

function emptyData(): ConvData {
  return { stack: [] };
}

function say(c: Ctx, body: string, options?: Option[], kind = "REPLY") {
  c.replies.push({ body, options, kind });
  c.data.options = options;
}

async function patientOf(c: Ctx) {
  if (!c.patientId) return null;
  return c.tx.patient.findFirst({
    where: { id: c.patientId, clinicId: c.clinic.id },
    select: { id: true, fullName: true, phone: true, dateOfBirth: true, sex: true, registrationStatus: true },
  });
}

function resolveOption(input: Input, options: Option[] | undefined): Option | null {
  if (!options || options.length === 0) return null;
  if (input.optionId) return options.find((option) => option.id === input.optionId) ?? null;
  const text = input.text.trim().toLowerCase();
  if (/^\d{1,2}$/.test(text)) return options[Number(text) - 1] ?? null;
  return options.find((option) => option.title.toLowerCase() === text) ?? null;
}

function localToday(c: Ctx) {
  return clinicLocalDate(c.now, c.clinic.timezone);
}

function dobText(date: Date | null) {
  return date ? formatDobForDisplay(date.toISOString().slice(0, 10)) : "not provided";
}

function sexText(sex: string | null) {
  return ({ MALE: "Male", FEMALE: "Female", OTHER: "Other", NOT_SPECIFIED: "Prefer not to say" } as Record<string, string>)[sex ?? ""] ?? "not provided";
}

const MAIN_MENU: Option[] = [
  { id: "book", title: "Book an appointment" },
  { id: "manage", title: "Manage my appointments" },
  { id: "update", title: "Update my details" },
  { id: "info", title: "Clinic information" },
  { id: "reception", title: "Talk to reception" },
];

const YES_NO = (yes: string, no: string): Option[] => [
  { id: "yes", title: yes },
  { id: "no", title: no },
];

// ---------- Prompts: every state can be re-asked, which powers back, resume and invalid-answer recovery ----------

async function prompt(c: Ctx, state: S, prefix = ""): Promise<void> {
  const lead = prefix ? `${prefix}\n\n` : "";
  switch (state) {
    case S.MAIN_MENU: {
      const patient = await patientOf(c);
      const greeting = patient ? `Hi ${firstName(patient.fullName)}! 👋` : "Hi! 👋";
      const intro = prefix ? "" : `${greeting} Welcome to ${c.clinic.name}. I'm DocDesk, your clinic assistant.\n\n`;
      say(c, `${lead}${intro}How can I help you today?`, MAIN_MENU);
      return;
    }
    case S.ASKING_VISITED:
      say(c, `${lead}Sure! Have you visited us before?`, [
        { id: "existing", title: "Yes, I'm an existing patient" },
        { id: "new", title: "No, this is my first visit" },
      ]);
      return;
    case S.VERIFYING_EXISTING_PATIENT:
      say(c, `${lead}To protect your privacy, please type your date of birth (for example 25/03/1990).`);
      return;
    case S.CONSENT_REGISTRATION:
      say(
        c,
        `${lead}To book your visit I'll save your name, date of birth and this phone number, so ${c.clinic.name} can find your record. Your details are only used by the clinic. Is that OK?`,
        YES_NO("Yes, that's OK", "No, not now"),
      );
      return;
    case S.COLLECTING_NAME:
      say(c, `${lead}${c.data.flow === "register" ? "Step 1 of 3 · " : ""}What's your full name?`);
      return;
    case S.COLLECTING_DOB:
      say(c, `${lead}${c.data.flow === "register" ? "Step 2 of 3 · " : ""}What's your date of birth? You can type it like 25/03/1990.`);
      return;
    case S.COLLECTING_SEX:
      say(c, `${lead}${c.data.flow === "register" ? "Step 3 of 3 · " : ""}What is your sex? The doctor uses this for your care.`, [
        { id: "MALE", title: "Male" },
        { id: "FEMALE", title: "Female" },
        { id: "OTHER", title: "Other" },
        { id: "NOT_SPECIFIED", title: "Prefer not to say" },
      ]);
      return;
    case S.CONFIRMING_DETAILS: {
      const patient = await patientOf(c);
      say(
        c,
        `${lead}Here's what I have:\n• Name: ${patient?.fullName ?? "-"}\n• Date of birth: ${dobText(patient?.dateOfBirth ?? null)}\n• Sex: ${sexText(patient?.sex ?? null)}\n• Phone: +${c.phone}\n\nIs this correct?`,
        [
          { id: "confirm", title: "Yes, that's correct" },
          { id: "edit_name", title: "Change my name" },
          { id: "edit_dob", title: "Change date of birth" },
          { id: "edit_sex", title: "Change sex" },
        ],
      );
      return;
    }
    case S.OFFERING_MESSAGING_CONSENT:
      say(
        c,
        `${lead}Would you like appointment confirmations and reminders on this WhatsApp number? You can reply STOP at any time to opt out.`,
        YES_NO("Yes, please", "No thanks"),
      );
      return;
    case S.SELECTING_DEPARTMENT: {
      const departments = await listDepartmentsWithDoctors(c.tx, c.clinic.id);
      if (departments.length === 0) {
        say(c, `${lead}I can't find any doctors to book right now. Would you like to talk to reception?`, [
          { id: "reception", title: "Talk to reception" },
          { id: "menu", title: "Main menu" },
        ]);
        return;
      }
      say(c, `${lead}Which department would you like to visit?`, departments.slice(0, 10).map((d) => ({ id: d.id, title: d.name })));
      return;
    }
    case S.SELECTING_DOCTOR: {
      const doctors = await listDoctors(c.tx, c.clinic.id, c.data.departmentId ?? "");
      say(c, `${lead}Would you like a particular doctor in ${c.data.departmentName ?? "this department"}?`, [
        { id: "any", title: "Any available doctor" },
        ...doctors.slice(0, 9).map((d) => ({ id: d.id, title: d.name })),
      ]);
      return;
    }
    case S.SELECTING_DATE: {
      const today = localToday(c);
      const pool = await loadSchedulePool(c.tx, {
        clinicId: c.clinic.id,
        departmentId: c.data.departmentId ?? "",
        doctorId: c.data.doctorId && c.data.doctorId !== "any" ? c.data.doctorId : undefined,
        fromDate: today,
        days: BOOKING_HORIZON_DAYS,
        now: c.now,
      });
      const options: Option[] = [];
      for (let offset = 0; offset < BOOKING_HORIZON_DAYS && options.length < 10; offset += 1) {
        const date = addDays(today, offset);
        const count = slotsForDate(pool, date, c.now).length;
        if (count > 0) options.push({ id: date, title: formatClinicDate(date, c.clinic.timezone), description: `${count} time${count === 1 ? "" : "s"} free` });
      }
      if (options.length === 0) {
        say(c, `${lead}There are no free appointments in the next ${BOOKING_HORIZON_DAYS} days. Would you like reception to help?`, [
          { id: "reception", title: "Talk to reception" },
          { id: "menu", title: "Main menu" },
        ]);
        return;
      }
      say(c, `${lead}Which day works for you?`, options);
      return;
    }
    case S.SELECTING_SLOT: {
      const date = c.data.date ?? localToday(c);
      const pool = await loadSchedulePool(c.tx, {
        clinicId: c.clinic.id,
        departmentId: c.data.departmentId ?? "",
        doctorId: c.data.doctorId && c.data.doctorId !== "any" ? c.data.doctorId : undefined,
        fromDate: date,
        days: 1,
        now: c.now,
      });
      const slots = slotsForDate(pool, date, c.now).slice(0, 9);
      if (slots.length === 0) {
        say(c, `${lead}That day is fully booked or the clinic is closed. Let's pick another day.`, [{ id: "other_date", title: "Choose another day" }]);
        return;
      }
      const showDoctor = !c.data.doctorId || c.data.doctorId === "any";
      say(c, `${lead}Free times on ${formatClinicDate(date, c.clinic.timezone)}:`, [
        ...slots.map((slot) => ({
          id: `${slot.doctorId}|${slot.startsAt.toISOString()}`,
          title: formatClinicTime(slot.startsAt, c.clinic.timezone),
          description: showDoctor ? slot.doctorName : undefined,
        })),
        { id: "other_date", title: "Choose another day" },
      ]);
      return;
    }
    case S.CONFIRMING_BOOKING: {
      const slot = c.data.slot;
      if (!slot) return prompt(c, S.SELECTING_SLOT, prefix);
      const startsAt = new Date(slot.startsAt);
      say(
        c,
        `${lead}Please confirm your appointment:\n• ${c.data.departmentName ?? "Consultation"}\n• ${slot.doctorName}\n• ${formatClinicDate(startsAt, c.clinic.timezone)}, ${formatClinicTime(startsAt, c.clinic.timezone)}\n\nI'm holding this time for ${HOLD_MINUTES} minutes.`,
        [
          { id: "confirm", title: "Confirm booking" },
          { id: "change", title: "Pick a different time" },
          { id: "cancel_flow", title: "Cancel" },
        ],
      );
      return;
    }
    case S.MANAGING_APPOINTMENTS: {
      const appointments = await c.tx.appointment.findMany({
        where: { clinicId: c.clinic.id, patientId: c.patientId ?? "", status: AppointmentStatus.BOOKED, startsAt: { gt: c.now } },
        select: { id: true, startsAt: true, doctor: { select: { membership: { select: { user: { select: { displayName: true } } } } } } },
        orderBy: { startsAt: "asc" },
        take: 9,
      });
      if (appointments.length === 0) {
        say(c, `${lead}You don't have any upcoming appointments.`, [
          { id: "book", title: "Book an appointment" },
          { id: "menu", title: "Main menu" },
        ]);
        return;
      }
      say(c, `${lead}Here are your upcoming appointments. Which one would you like to look at?`, appointments.map((a) => ({
        id: a.id,
        title: `${formatClinicDate(a.startsAt, c.clinic.timezone)}, ${formatClinicTime(a.startsAt, c.clinic.timezone)}`,
        description: a.doctor.membership.user.displayName,
      })));
      return;
    }
    case S.MANAGING_APPOINTMENT_DETAIL: {
      const appointment = await c.tx.appointment.findFirst({
        where: { id: c.data.appointmentId ?? "", clinicId: c.clinic.id, patientId: c.patientId ?? "" },
        select: { reference: true, startsAt: true, doctor: { select: { membership: { select: { user: { select: { displayName: true } } } } } } },
      });
      if (!appointment) return prompt(c, S.MANAGING_APPOINTMENTS, prefix);
      say(
        c,
        `${lead}Appointment ${appointment.reference}\n• ${appointment.doctor.membership.user.displayName}\n• ${formatClinicDate(appointment.startsAt, c.clinic.timezone)}, ${formatClinicTime(appointment.startsAt, c.clinic.timezone)}\n\nTo change the time, cancel it and book a new one.`,
        [
          { id: "cancel_appt", title: "Cancel this appointment" },
          { id: "list", title: "Back to my appointments" },
          { id: "menu", title: "Main menu" },
        ],
      );
      return;
    }
    case S.CONFIRMING_CANCELLATION:
      say(c, `${lead}Are you sure you want to cancel this appointment?`, YES_NO("Yes, cancel it", "No, keep it"));
      return;
    case S.CHOOSING_UPDATE_FIELD:
      say(c, `${lead}What would you like to update?`, [
        { id: "name", title: "My name" },
        { id: "dob", title: "My date of birth" },
        { id: "sex", title: "My sex" },
      ]);
      return;
    case S.RESUME_PROMPT: {
      const reason =
        c.data.resumeReason === "stuck"
          ? "I'm having trouble understanding. What would you like to do?"
          : "Welcome back! Would you like to carry on where we left off?";
      say(c, `${lead}${reason}`, [
        { id: "continue", title: "Carry on" },
        { id: "menu", title: "Main menu" },
        { id: "reception", title: "Talk to reception" },
      ]);
      return;
    }
    default:
      return prompt(c, S.MAIN_MENU, prefix);
  }
}

async function goto(c: Ctx, state: S, prefix = "", push = true) {
  if (push && c.state !== state && c.state !== S.IDLE && c.state !== S.RESUME_PROMPT) {
    c.data.stack = [...c.data.stack, c.state].slice(-10);
  }
  c.state = state;
  c.data.invalid = 0;
  await prompt(c, state, prefix);
}

async function resetToMenu(c: Ctx, prefix = "") {
  if (c.data.holdId) {
    await releaseHold(c.tx, c.clinic.id, c.data.holdId);
  }
  c.data = { stack: [] };
  c.state = S.MAIN_MENU;
  await prompt(c, S.MAIN_MENU, prefix);
}

async function handover(c: Ctx, why: string) {
  if (c.data.holdId) await releaseHold(c.tx, c.clinic.id, c.data.holdId);
  c.mode = ConversationMode.HUMAN;
  c.state = S.HUMAN_HANDOVER;
  c.data = { stack: [] };
  c.audits.push({ clinicId: c.clinic.id, action: "CONVERSATION_HANDOVER_REQUESTED", entity: "WhatsAppConversation", entityId: c.conversationId, metadata: { why } });
  const phone = c.clinic.phone ? ` You can also call us on ${c.clinic.phone}.` : "";
  say(c, `Thanks. I've asked our reception team to help you, and they'll reply here soon.${phone}`, undefined, "HANDOVER");
}

async function invalid(c: Ctx, hint: string) {
  c.data.invalid = (c.data.invalid ?? 0) + 1;
  if (c.data.invalid >= MAX_INVALID) {
    c.data.resumeState = c.state;
    c.data.resumeReason = "stuck";
    c.state = S.RESUME_PROMPT;
    c.data.invalid = 0;
    await prompt(c, S.RESUME_PROMPT);
    return;
  }
  await prompt(c, c.state, `${hint} (You can type "reception" at any time to talk to our team.)`);
}

async function recordConsent(c: Ctx, type: ConsentType, granted: boolean) {
  await c.tx.consentEvent.create({
    data: { clinicId: c.clinic.id, patientId: c.patientId, conversationId: c.conversationId, type, granted },
  });
  if (type === ConsentType.REGISTRATION && granted) c.registrationConsentAt = c.now;
  if (type === ConsentType.MESSAGING) c.messagingConsentAt = granted ? c.now : null;
}

// ---------- Flow helpers ----------

async function afterIdentified(c: Ctx, prefix: string) {
  const next = c.data.next;
  c.data.next = undefined;
  if (next === "book") return startBooking(c, prefix);
  if (next === "manage") return goto(c, S.MANAGING_APPOINTMENTS, prefix);
  if (next === "update") return goto(c, S.CHOOSING_UPDATE_FIELD, prefix);
  return resetToMenu(c, prefix);
}

async function startBooking(c: Ctx, prefix: string) {
  const departments = await listDepartmentsWithDoctors(c.tx, c.clinic.id);
  if (departments.length === 1) {
    c.data.departmentId = departments[0].id;
    c.data.departmentName = departments[0].name;
    return goto(c, S.SELECTING_DOCTOR, prefix);
  }
  return goto(c, S.SELECTING_DEPARTMENT, prefix);
}

async function nextRegistrationStep(c: Ctx, prefix: string) {
  const patient = await patientOf(c);
  if (!patient?.fullName) return goto(c, S.COLLECTING_NAME, prefix);
  if (!patient.dateOfBirth) return goto(c, S.COLLECTING_DOB, prefix);
  if (!c.data.sexAnswered) return goto(c, S.COLLECTING_SEX, prefix);
  return goto(c, S.CONFIRMING_DETAILS, prefix);
}

async function saveField(c: Ctx, field: "name" | "dob" | "sex", value: string | null) {
  let patient = await patientOf(c);
  if (field === "name") {
    const name = value ?? "";
    const normalizedName = name.toLocaleLowerCase().replace(/\s+/g, " ");
    if (!patient) {
      const created = await c.tx.patient.create({
        data: {
          clinicId: c.clinic.id,
          fullName: name,
          normalizedName,
          phone: `+${c.phone}`,
          normalizedPhone: c.phone,
          registrationStatus: RegistrationStatus.INCOMPLETE,
        },
        select: { id: true },
      });
      c.patientId = created.id;
      return;
    }
    await c.tx.patient.update({ where: { id: patient.id }, data: { fullName: name, normalizedName } });
    return;
  }
  patient = patient ?? (await patientOf(c));
  if (!patient) return;
  if (field === "dob") {
    await c.tx.patient.update({ where: { id: patient.id }, data: { dateOfBirth: value ? new Date(`${value}T00:00:00.000Z`) : null } });
  } else {
    await c.tx.patient.update({ where: { id: patient.id }, data: { sex: value } });
    c.data.sexAnswered = true;
  }
}

async function afterFieldSaved(c: Ctx, ack: string) {
  if (c.data.flow === "update") {
    c.data.flow = undefined;
    c.audits.push({ clinicId: c.clinic.id, action: "PATIENT_UPDATED_VIA_WHATSAPP", entity: "Patient", entityId: c.patientId ?? "" });
    return resetToMenu(c, `${ack} Your details are updated. ✅`);
  }
  if (c.data.flow === "edit-confirm") {
    c.data.flow = "register";
    return goto(c, S.CONFIRMING_DETAILS, ack, false);
  }
  return nextRegistrationStep(c, ack);
}

async function finishRegistration(c: Ctx) {
  const draft = await patientOf(c);
  if (!draft) return goto(c, S.COLLECTING_NAME);
  const last10 = c.phone.slice(-10);
  const existing = draft.dateOfBirth
    ? await c.tx.patient.findFirst({
        where: {
          clinicId: c.clinic.id,
          id: { not: draft.id },
          registrationStatus: RegistrationStatus.COMPLETE,
          normalizedPhone: { endsWith: last10 },
          dateOfBirth: draft.dateOfBirth,
        },
        select: { id: true, fullName: true },
      })
    : null;
  let prefix: string;
  if (existing) {
    // The same person is already on record; reuse that record instead of creating a duplicate.
    const unused = await c.tx.appointment.count({ where: { patientId: draft.id } });
    c.patientId = existing.id;
    if (unused === 0) await c.tx.patient.deleteMany({ where: { id: draft.id, clinicId: c.clinic.id, registrationStatus: RegistrationStatus.INCOMPLETE } });
    prefix = `Good news ${firstName(existing.fullName)}, you're already registered with us.`;
  } else {
    await c.tx.patient.update({ where: { id: draft.id }, data: { registrationStatus: RegistrationStatus.COMPLETE } });
    c.audits.push({ clinicId: c.clinic.id, action: "PATIENT_REGISTERED", entity: "Patient", entityId: draft.id, metadata: { source: "WHATSAPP" } });
    prefix = `Thank you ${firstName(draft.fullName)}, you're registered. ✅`;
  }
  c.data.flow = undefined;
  if (!c.messagingConsentAt) return goto(c, S.OFFERING_MESSAGING_CONSENT, prefix);
  return afterIdentified(c, prefix);
}

// ---------- State handlers ----------

async function verifyExisting(c: Ctx, input: Input) {
  const dob = parseDateOfBirth(input.text, localToday(c));
  if (!dob) return invalid(c, "I couldn't read that date. Please type it like 25/03/1990.");
  const matches = await c.tx.patient.findMany({
    where: {
      clinicId: c.clinic.id,
      registrationStatus: RegistrationStatus.COMPLETE,
      normalizedPhone: { endsWith: c.phone.slice(-10) },
      dateOfBirth: new Date(`${dob}T00:00:00.000Z`),
    },
    select: { id: true, fullName: true },
    take: 2,
  });
  if (matches.length === 1) {
    c.patientId = matches[0].id;
    c.data.verifyAttempts = 0;
    c.audits.push({ clinicId: c.clinic.id, action: "PATIENT_VERIFIED_VIA_WHATSAPP", entity: "Patient", entityId: matches[0].id });
    return afterIdentified(c, `Thanks ${firstName(matches[0].fullName)}, you're verified. ✅`);
  }
  if (matches.length > 1) return handover(c, "More than one matching patient record");
  c.data.verifyAttempts = (c.data.verifyAttempts ?? 0) + 1;
  if (c.data.verifyAttempts >= MAX_VERIFY_ATTEMPTS) {
    return handover(c, "Could not verify patient identity");
  }
  return prompt(c, S.VERIFYING_EXISTING_PATIENT, "I couldn't find a record with that date of birth for this number. Please check and try again.");
}

async function startNewPatient(c: Ctx) {
  const onRecord = await c.tx.patient.findFirst({
    where: { clinicId: c.clinic.id, registrationStatus: RegistrationStatus.COMPLETE, normalizedPhone: { endsWith: c.phone.slice(-10) } },
    select: { id: true },
  });
  if (onRecord && !c.patientId) {
    // One record per phone number: never create a duplicate, verify instead.
    return goto(c, S.VERIFYING_EXISTING_PATIENT, "I may already have you on record under this number.");
  }
  if (!c.registrationConsentAt) return goto(c, S.CONSENT_REGISTRATION);
  c.data.flow = "register";
  return nextRegistrationStep(c, "");
}

async function onState(c: Ctx, input: Input): Promise<void> {
  const choice = resolveOption(input, c.data.options);
  switch (c.state) {
    case S.IDLE:
    case S.COMPLETED:
    case S.HUMAN_HANDOVER:
      return resetToMenu(c, c.state === S.COMPLETED ? "Is there anything else I can help with?" : "");

    case S.MAIN_MENU: {
      if (!choice) return invalid(c, "Please choose one of the options below.");
      if (choice.id === "reception") return handover(c, "Requested from menu");
      if (choice.id === "info") {
        const lines = [`${c.clinic.name}`, c.clinic.address ? `📍 ${c.clinic.address}` : null, c.clinic.phone ? `📞 ${c.clinic.phone}` : null].filter(Boolean);
        return resetToMenu(c, lines.join("\n"));
      }
      if (choice.id === "book") {
        c.data.next = "book";
        const patient = await patientOf(c);
        if (patient?.registrationStatus === RegistrationStatus.COMPLETE) return afterIdentified(c, "");
        if (patient) return startNewPatient(c);
        return goto(c, S.ASKING_VISITED);
      }
      c.data.next = choice.id === "manage" ? "manage" : "update";
      const patient = await patientOf(c);
      if (patient?.registrationStatus === RegistrationStatus.COMPLETE) return afterIdentified(c, "");
      return goto(c, S.VERIFYING_EXISTING_PATIENT, "I'll need to check it's you first.");
    }

    case S.ASKING_VISITED:
      if (!choice) return invalid(c, "Please choose one of the options below.");
      if (choice.id === "existing") return goto(c, S.VERIFYING_EXISTING_PATIENT);
      return startNewPatient(c);

    case S.VERIFYING_EXISTING_PATIENT:
      return verifyExisting(c, input);

    case S.CONSENT_REGISTRATION:
      if (!choice) return invalid(c, "Please choose Yes or No.");
      if (choice.id === "no") return resetToMenu(c, "No problem. I haven't saved anything. You can book any time.");
      await recordConsent(c, ConsentType.REGISTRATION, true);
      c.data.flow = "register";
      return nextRegistrationStep(c, "Thank you.");

    case S.COLLECTING_NAME: {
      const name = parseName(input.text);
      if (!name) return invalid(c, "Please type your full name using letters, for example Rahul Sharma.");
      await saveField(c, "name", name);
      return afterFieldSaved(c, `Thanks, ${firstName(name)}.`);
    }

    case S.COLLECTING_DOB: {
      const dob = parseDateOfBirth(input.text, localToday(c));
      if (!dob) return invalid(c, "I couldn't read that date. Please type it like 25/03/1990.");
      await saveField(c, "dob", dob);
      return afterFieldSaved(c, "Got it.");
    }

    case S.COLLECTING_SEX: {
      if (!choice) return invalid(c, "Please choose one of the options below.");
      await saveField(c, "sex", choice.id);
      return afterFieldSaved(c, "Noted.");
    }

    case S.CONFIRMING_DETAILS: {
      if (!choice) return invalid(c, "Please choose one of the options below.");
      if (choice.id === "confirm") return finishRegistration(c);
      c.data.flow = "edit-confirm";
      if (choice.id === "edit_name") return goto(c, S.COLLECTING_NAME, "", false);
      if (choice.id === "edit_dob") return goto(c, S.COLLECTING_DOB, "", false);
      return goto(c, S.COLLECTING_SEX, "", false);
    }

    case S.OFFERING_MESSAGING_CONSENT: {
      if (!choice) return invalid(c, "Please choose Yes or No.");
      await recordConsent(c, ConsentType.MESSAGING, choice.id === "yes");
      return afterIdentified(c, choice.id === "yes" ? "Great, I'll keep you updated." : "No problem, no reminders will be sent.");
    }

    case S.SELECTING_DEPARTMENT: {
      if (!choice) return invalid(c, "Please choose one of the options below.");
      if (choice.id === "reception") return handover(c, "No departments available");
      if (choice.id === "menu") return resetToMenu(c);
      c.data.departmentId = choice.id;
      c.data.departmentName = choice.title;
      return goto(c, S.SELECTING_DOCTOR);
    }

    case S.SELECTING_DOCTOR: {
      if (!choice) return invalid(c, "Please choose one of the options below.");
      c.data.doctorId = choice.id;
      c.data.doctorName = choice.id === "any" ? undefined : choice.title;
      return goto(c, S.SELECTING_DATE);
    }

    case S.SELECTING_DATE: {
      if (!choice) return invalid(c, "Please choose one of the options below.");
      if (choice.id === "reception") return handover(c, "No availability");
      if (choice.id === "menu") return resetToMenu(c);
      c.data.date = choice.id;
      return goto(c, S.SELECTING_SLOT);
    }

    case S.SELECTING_SLOT: {
      if (!choice) return invalid(c, "Please choose one of the times below.");
      if (choice.id === "other_date") return goto(c, S.SELECTING_DATE);
      const [doctorId, startsIso] = choice.id.split("|");
      const startsAt = new Date(startsIso);
      if (!doctorId || Number.isNaN(startsAt.valueOf()) || !c.patientId || !c.data.departmentId) {
        return invalid(c, "Please choose one of the times below.");
      }
      const doctors = await listDoctors(c.tx, c.clinic.id, c.data.departmentId);
      const doctor = doctors.find((entry) => entry.id === doctorId);
      const minutes = await c.tx.doctorProfile.findFirst({ where: { id: doctorId, clinicId: c.clinic.id }, select: { consultationMinutes: true } });
      if (!doctor || !minutes) return invalid(c, "Please choose one of the times below.");
      if (c.data.holdId) {
        await releaseHold(c.tx, c.clinic.id, c.data.holdId);
        c.data.holdId = undefined;
      }
      const endsAt = new Date(startsAt.valueOf() + minutes.consultationMinutes * 60_000);
      const hold = await createHold(c.tx, {
        clinicId: c.clinic.id,
        patientId: c.patientId,
        doctorId,
        departmentId: c.data.departmentId,
        startsAt,
        endsAt,
        now: c.now,
      });
      if (!hold.ok) return prompt(c, S.SELECTING_SLOT, "Sorry, that time was just taken. Here are the times that are still free.");
      c.data.holdId = hold.holdId;
      c.data.slot = { doctorId, doctorName: doctor.name, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
      return goto(c, S.CONFIRMING_BOOKING);
    }

    case S.CONFIRMING_BOOKING: {
      if (!choice) return invalid(c, "Please choose one of the options below.");
      if (choice.id === "cancel_flow") return resetToMenu(c, "No problem, I've cancelled that.");
      if (choice.id === "change") {
        if (c.data.holdId) await releaseHold(c.tx, c.clinic.id, c.data.holdId);
        c.data.holdId = undefined;
        return goto(c, S.SELECTING_SLOT);
      }
      if (!c.data.holdId || !c.patientId) return goto(c, S.SELECTING_SLOT, "Let's find a time again.");
      const result = await confirmHold(c.tx, {
        clinicId: c.clinic.id,
        patientId: c.patientId,
        holdId: c.data.holdId,
        source: AppointmentSource.WHATSAPP,
      });
      if (!result.ok) {
        c.data.holdId = undefined;
        const why = result.reason === "EXPIRED" ? "Your held time ran out." : "Sorry, that time was just taken.";
        return goto(c, S.SELECTING_SLOT, `${why} Here are the times that are free now.`, false);
      }
      const when = `${formatClinicDate(result.appointment.startsAt, c.clinic.timezone)}, ${formatClinicTime(result.appointment.startsAt, c.clinic.timezone)}`;
      const doctorName = c.data.slot?.doctorName ?? "your doctor";
      const clinicLine = c.clinic.address ? `\n📍 ${c.clinic.address}` : "";
      c.data = { stack: [] };
      c.state = S.COMPLETED;
      say(c, `✅ You're booked!\n\n${doctorName}\n🗓 ${when}\nReference: ${result.appointment.reference}${clinicLine}\n\nPlease arrive 10 minutes early. Reply "menu" if you need anything else.`, undefined, "BOOKING_CONFIRMATION");
      return;
    }

    case S.MANAGING_APPOINTMENTS: {
      if (!choice) return invalid(c, "Please choose one of the options below.");
      if (choice.id === "book") {
        c.data.next = "book";
        return afterIdentified(c, "");
      }
      if (choice.id === "menu") return resetToMenu(c);
      c.data.appointmentId = choice.id;
      return goto(c, S.MANAGING_APPOINTMENT_DETAIL);
    }

    case S.MANAGING_APPOINTMENT_DETAIL: {
      if (!choice) return invalid(c, "Please choose one of the options below.");
      if (choice.id === "menu") return resetToMenu(c);
      if (choice.id === "list") return goto(c, S.MANAGING_APPOINTMENTS, "", false);
      return goto(c, S.CONFIRMING_CANCELLATION);
    }

    case S.CONFIRMING_CANCELLATION: {
      if (!choice) return invalid(c, "Please choose Yes or No.");
      if (choice.id === "no") return resetToMenu(c, "Okay, your appointment is unchanged.");
      const result = await cancelAppointment(c.tx, {
        clinicId: c.clinic.id,
        appointmentId: c.data.appointmentId ?? "",
        patientId: c.patientId ?? "",
        reason: "Cancelled by patient on WhatsApp",
        actorLabel: "PATIENT_WHATSAPP",
      });
      if (!result.ok) return resetToMenu(c, "I couldn't cancel that appointment because it has already changed. Please check with reception.");
      return resetToMenu(c, "Your appointment is cancelled. ✅ You can book a new time whenever you like.");
    }

    case S.CHOOSING_UPDATE_FIELD: {
      if (!choice) return invalid(c, "Please choose one of the options below.");
      c.data.flow = "update";
      if (choice.id === "name") return goto(c, S.COLLECTING_NAME);
      if (choice.id === "dob") return goto(c, S.COLLECTING_DOB);
      return goto(c, S.COLLECTING_SEX);
    }

    case S.RESUME_PROMPT: {
      if (!choice) return invalid(c, "Please choose one of the options below.");
      if (choice.id === "menu") return resetToMenu(c);
      if (choice.id === "reception") return handover(c, "Requested after stuck or expired session");
      let target = c.data.resumeState ?? S.MAIN_MENU;
      c.data.resumeReason = undefined;
      if (target === S.CONFIRMING_BOOKING) {
        const hold = c.data.holdId
          ? await c.tx.appointmentHold.findFirst({ where: { id: c.data.holdId, clinicId: c.clinic.id, status: "ACTIVE", expiresAt: { gt: c.now } }, select: { id: true } })
          : null;
        if (!hold) target = S.SELECTING_SLOT;
      }
      c.state = target;
      c.data.invalid = 0;
      return prompt(c, target, "Welcome back!");
    }

    default:
      return resetToMenu(c);
  }
}

async function dispatch(c: Ctx, input: Input) {
  const text = input.text.trim();
  const lower = text.toLowerCase();

  if (c.state === S.IDLE) return resetToMenu(c);
  if (MENU_WORDS.has(lower) && !input.optionId) return resetToMenu(c, "Sure, let's start again.");
  if (HUMAN_WORDS.has(lower) && !input.optionId) return handover(c, "Patient asked for reception");

  const idleLimit = c.now.valueOf() - SESSION_MINUTES * 60_000;
  const midFlow = !([S.MAIN_MENU, S.COMPLETED, S.RESUME_PROMPT, S.HUMAN_HANDOVER] as S[]).includes(c.state);
  if (midFlow && c.stateUpdatedAt.valueOf() < idleLimit) {
    c.data.resumeState = c.state;
    c.data.resumeReason = "expired";
    c.state = S.RESUME_PROMPT;
    return prompt(c, S.RESUME_PROMPT);
  }

  if (lower === "back" && !input.optionId) {
    const previous = c.data.stack[c.data.stack.length - 1];
    if (!previous) return resetToMenu(c);
    c.data.stack = c.data.stack.slice(0, -1);
    if (c.state === S.CONFIRMING_BOOKING && c.data.holdId) {
      await releaseHold(c.tx, c.clinic.id, c.data.holdId);
      c.data.holdId = undefined;
    }
    c.state = previous;
    return prompt(c, previous);
  }
  if (lower === "cancel" && !input.optionId && !([S.MAIN_MENU, S.COMPLETED, S.CONFIRMING_CANCELLATION] as S[]).includes(c.state)) {
    return resetToMenu(c, "No problem, I've cancelled that.");
  }
  if (lower === "help" && !input.optionId) return prompt(c, c.state);
  return onState(c, input);
}



// Runs one inbound message against the persisted conversation. The caller must already hold the conversation lock.
export async function runEngine(
  tx: Tx,
  args: { clinicId: string; conversationId: string; eventKey: string; input: Input; now?: Date },
): Promise<EngineResult> {
  const now = args.now ?? new Date();
  await tx.$queryRaw`SELECT "id" FROM "WhatsAppConversation" WHERE "id" = ${args.conversationId}::uuid FOR UPDATE`;
  const conversation = await tx.whatsAppConversation.findFirstOrThrow({
    where: { id: args.conversationId, clinicId: args.clinicId },
  });
  const clinic = await tx.clinic.findUniqueOrThrow({
    where: { id: args.clinicId },
    select: { id: true, name: true, timezone: true, phone: true, address: true },
  });
  const stored = (conversation.context ?? {}) as Partial<ConvData>;
  const c: Ctx = {
    tx,
    clinic,
    conversationId: conversation.id,
    phone: conversation.phone,
    now,
    state: conversation.state,
    mode: conversation.mode,
    patientId: conversation.patientId,
    optedOutAt: conversation.optedOutAt,
    registrationConsentAt: conversation.registrationConsentAt,
    messagingConsentAt: conversation.messagingConsentAt,
    data: { ...emptyData(), ...stored, stack: stored.stack ?? [] },
    replies: [],
    audits: [],
    stateUpdatedAt: conversation.stateUpdatedAt,
  };
  const lower = args.input.text.trim().toLowerCase();

  if (OPT_OUT_WORDS.has(lower)) {
    c.optedOutAt = now;
    c.messagingConsentAt = null;
    await recordConsent(c, ConsentType.MESSAGING, false);
    say(c, `You're opted out of messages from ${clinic.name}. Reply START any time to opt back in.`, undefined, "OPT_OUT_ACK");
  } else if (c.optedOutAt) {
    if (lower === "start") {
      c.optedOutAt = null;
      await recordConsent(c, ConsentType.MESSAGING, true);
      await prompt(c, S.MAIN_MENU, "Welcome back! You're subscribed again.");
      c.state = S.MAIN_MENU;
    }
  } else if (c.mode === ConversationMode.HUMAN) {
    // A person is in control. The bot stays silent.
  } else {
    await dispatch(c, args.input);
  }

  await tx.whatsAppConversation.update({
    where: { id: conversation.id },
    data: {
      state: c.state,
      mode: c.mode,
      patientId: c.patientId,
      optedOutAt: c.optedOutAt,
      registrationConsentAt: c.registrationConsentAt,
      messagingConsentAt: c.messagingConsentAt,
      context: c.data as unknown as Prisma.InputJsonValue,
      stateUpdatedAt: c.state === conversation.state && c.replies.length === 0 ? conversation.stateUpdatedAt : now,
      version: { increment: 1 },
    },
  });
  if (c.audits.length > 0) await tx.auditLog.createMany({ data: c.audits });
  if (c.replies.length > 0) {
    await tx.whatsAppMessage.createMany({
      data: c.replies.map((reply, index) => ({
        conversationId: conversation.id,
        direction: "OUTBOUND" as const,
        sender: MessageSender.BOT,
        body: reply.body,
        interactive: reply.options ? (reply.options as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        kind: reply.kind ?? "REPLY",
        status: MessageStatus.QUEUED,
        isSimulated: conversation.isSimulated,
        idempotencyKey: `${args.eventKey}:${index}`,
      })),
      skipDuplicates: true,
    });
  }
  return { replies: c.replies.length, state: c.state };
}

export { normalizePhone };
