import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { AppointmentStatus, ConversationMode, ConversationState, MessageStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withWorker } from "@/lib/tenant-db";
import { confirmHold, createHold } from "@/lib/booking-service";
import { ingestInbound, processConversation } from "@/lib/whatsapp/events";
import { dispatchOutbox } from "@/lib/whatsapp/outbox";

const run = randomUUID().slice(0, 8);
let clinicId = "";
let doctorId = "";
let departmentId = "";
let phoneCounter = 0;

const phoneBase = 6000000000 + Math.floor(Math.random() * 3000000000);
function newPhone() {
  phoneCounter += 1;
  return `91${phoneBase + phoneCounter}`;
}

async function say(phone: string, text: string) {
  const result = await ingestInbound({ clinicId, phone, eventKey: `t:${randomUUID()}`, text, simulated: true });
  if (result.conversationId) {
    await processConversation(result.conversationId);
    await dispatchOutbox(50);
  }
  return conversationOf(phone);
}

async function conversationOf(phone: string) {
  return prisma.whatsAppConversation.findFirstOrThrow({ where: { clinicId, phone }, include: { messages: { orderBy: { seq: "asc" } } } });
}

function lastBot(conversation: { messages: { direction: string; body: string }[] }) {
  return [...conversation.messages].reverse().find((m) => m.direction === "OUTBOUND")?.body ?? "";
}

before(async () => {
  const clinic = await prisma.clinic.create({ data: { name: `Test Clinic ${run}`, timezone: "Asia/Kolkata", phone: "+91 40000", address: "1 Test Road" } });
  clinicId = clinic.id;
  const user = await prisma.user.create({ data: { authSubject: randomUUID(), email: `dr-${run}@example.test`, displayName: "Dr. Test" } });
  const membership = await prisma.membership.create({ data: { clinicId, userId: user.id, role: "DOCTOR" } });
  const doctor = await prisma.doctorProfile.create({ data: { clinicId, membershipId: membership.id, consultationMinutes: 30 } });
  doctorId = doctor.id;
  const department = await prisma.department.create({ data: { clinicId, name: "General", code: "GEN" } });
  departmentId = department.id;
  await prisma.doctorDepartment.create({ data: { doctorId, departmentId } });
  for (const weekday of [1, 2, 3, 4, 5, 6, 7]) {
    await prisma.doctorAvailability.create({ data: { doctorId, weekday, startsAt: "00:00", endsAt: "23:30" } });
  }
});

after(async () => {
  await prisma.$disconnect();
});

describe("WhatsApp conversation engine (real PostgreSQL)", () => {
  it("registers a new patient and books an appointment end to end", async () => {
    const phone = newPhone();
    for (const text of ["hi", "1", "2", "1", "Rahul Sharma", "25/03/1990", "1", "1", "1"]) await say(phone, text);
    let conversation = await conversationOf(phone);
    assert.equal(conversation.state, ConversationState.SELECTING_DOCTOR);
    for (const text of ["1", "1", "1", "1"]) conversation = await say(phone, text);
    assert.equal(conversation.state, ConversationState.COMPLETED);
    assert.match(lastBot(conversation), /You're booked/);

    const patient = await prisma.patient.findFirstOrThrow({ where: { clinicId, normalizedPhone: phone } });
    assert.equal(patient.registrationStatus, "COMPLETE");
    assert.equal(patient.fullName, "Rahul Sharma");
    const appointments = await prisma.appointment.findMany({ where: { clinicId, patientId: patient.id } });
    assert.equal(appointments.length, 1);
    assert.equal(appointments[0].source, "WHATSAPP");
    assert.equal(await prisma.scheduleBlock.count({ where: { appointmentId: appointments[0].id } }), 1);
    const consents = await prisma.consentEvent.findMany({ where: { conversationId: conversation.id } });
    assert.deepEqual(consents.map((c) => c.type).sort(), ["MESSAGING", "REGISTRATION"]);
    assert.ok(conversation.messages.filter((m) => m.direction === "OUTBOUND").every((m) => m.status === MessageStatus.SENT));
  });

  it("ignores a duplicate webhook delivery", async () => {
    const phone = newPhone();
    const eventKey = `message:dup-${randomUUID()}`;
    const first = await ingestInbound({ clinicId, phone, eventKey, text: "hi" });
    const second = await ingestInbound({ clinicId, phone, eventKey, text: "hi" });
    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    await Promise.all([processConversation(first.conversationId!), processConversation(first.conversationId!)]);
    const conversation = await conversationOf(phone);
    assert.equal(conversation.messages.filter((m) => m.direction === "INBOUND").length, 1);
    assert.equal(conversation.messages.filter((m) => m.direction === "OUTBOUND").length, 1);
  });

  it("processes parallel messages for one conversation in order, each exactly once", async () => {
    const phone = newPhone();
    const texts = ["hi", "1", "2", "1", "Asha Menon"];
    let conversationId = "";
    for (const text of texts) {
      const result = await ingestInbound({ clinicId, phone, eventKey: `t:${randomUUID()}`, text, simulated: true });
      conversationId = result.conversationId!;
    }
    await Promise.all([1, 2, 3, 4].map(() => processConversation(conversationId)));
    const conversation = await conversationOf(phone);
    assert.equal(conversation.state, ConversationState.COLLECTING_DOB);
    const events = await prisma.webhookEvent.findMany({ where: { conversationId } });
    assert.ok(events.every((event) => event.status === "PROCESSED"));
    assert.equal(conversation.messages.filter((m) => m.direction === "OUTBOUND").length, texts.length);
    assert.equal(await prisma.patient.count({ where: { clinicId, normalizedPhone: phone } }), 1);
  });

  it("verifies an existing patient by date of birth and rejects a wrong one", async () => {
    const phone = newPhone();
    await prisma.patient.create({
      data: { clinicId, fullName: "Kiran Rao", normalizedName: "kiran rao", phone: `+91${phone.slice(2)}`, normalizedPhone: phone.slice(2), dateOfBirth: new Date("1985-07-01T00:00:00.000Z") },
    });
    for (const text of ["hi", "1", "1"]) await say(phone, text);
    let conversation = await say(phone, "01/01/2000");
    assert.equal(conversation.state, ConversationState.VERIFYING_EXISTING_PATIENT);
    assert.equal(conversation.patientId, null);
    conversation = await say(phone, "01/07/1985");
    assert.equal(conversation.state, ConversationState.SELECTING_DOCTOR);
    assert.ok(conversation.patientId);
  });

  it("hands over to reception after repeated failed verification", async () => {
    const phone = newPhone();
    await prisma.patient.create({
      data: { clinicId, fullName: "Lata Joshi", normalizedName: "lata joshi", phone: `+91${phone.slice(2)}`, normalizedPhone: phone.slice(2), dateOfBirth: new Date("1970-01-01T00:00:00.000Z") },
    });
    for (const text of ["hi", "1", "1", "02/02/1999", "03/03/1999"]) await say(phone, text);
    const conversation = await say(phone, "04/04/1999");
    assert.equal(conversation.mode, ConversationMode.HUMAN);
    assert.equal(conversation.patientId, null);
  });

  it("stays silent in human mode and suppresses queued bot replies after a takeover", async () => {
    const phone = newPhone();
    let conversation = await say(phone, "hi");
    await prisma.whatsAppMessage.create({
      data: { conversationId: conversation.id, direction: "OUTBOUND", sender: "BOT", body: "queued before takeover", status: "QUEUED", idempotencyKey: `q:${randomUUID()}`, isSimulated: true },
    });
    await prisma.whatsAppConversation.update({ where: { id: conversation.id }, data: { mode: ConversationMode.HUMAN } });
    await dispatchOutbox(50);
    conversation = await conversationOf(phone);
    const queued = conversation.messages.find((m) => m.body === "queued before takeover");
    assert.equal(queued?.status, MessageStatus.FAILED);
    assert.equal(queued?.errorCode, "HANDOVER_SUPPRESSED");
    const before = conversation.messages.length;
    conversation = await say(phone, "hello?");
    assert.equal(conversation.messages.length, before + 1, "only the inbound message is added");
  });

  it("honours STOP and START", async () => {
    const phone = newPhone();
    await say(phone, "hi");
    let conversation = await say(phone, "STOP");
    assert.ok(conversation.optedOutAt);
    assert.match(lastBot(conversation), /opted out/);
    const count = conversation.messages.length;
    conversation = await say(phone, "book");
    assert.equal(conversation.messages.length, count + 1);
    conversation = await say(phone, "start");
    assert.equal(conversation.optedOutAt, null);
  });

  it("lets a patient cancel only their own appointment", async () => {
    const phone = newPhone();
    for (const text of ["hi", "1", "2", "1", "Dev Patel", "02/02/1991", "2", "1", "1", "1", "1", "1", "1"]) await say(phone, text);
    let conversation = await conversationOf(phone);
    assert.equal(conversation.state, ConversationState.COMPLETED);
    for (const text of ["menu", "2", "1", "1", "1"]) conversation = await say(phone, text);
    const patient = await prisma.patient.findFirstOrThrow({ where: { clinicId, normalizedPhone: phone } });
    const appointment = await prisma.appointment.findFirstOrThrow({ where: { patientId: patient.id } });
    assert.equal(appointment.status, AppointmentStatus.CANCELLED);
    assert.equal(await prisma.scheduleBlock.count({ where: { appointmentId: appointment.id } }), 0);
  });

  it("lets only one of two patients confirm the same slot", async () => {
    const patients = await Promise.all(
      [1, 2].map((n) => prisma.patient.create({ data: { clinicId, fullName: `Race ${n}`, normalizedName: `race ${n}`, phone: `+9100${n}${run}`, normalizedPhone: `00${n}${run}` } })),
    );
    const startsAt = new Date(Date.now() + 3 * 24 * 60 * 60_000);
    startsAt.setUTCMinutes(0, 0, 0);
    const endsAt = new Date(startsAt.valueOf() + 30 * 60_000);
    const attempts = await Promise.all(
      patients.map((patient) =>
        withWorker(async (tx) => {
          const hold = await createHold(tx, { clinicId, patientId: patient.id, doctorId, departmentId, startsAt, endsAt, now: new Date() });
          if (!hold.ok) return { ok: false as const };
          return confirmHold(tx, { clinicId, patientId: patient.id, holdId: hold.holdId, source: "WHATSAPP" });
        }).catch(() => ({ ok: false as const })),
      ),
    );
    assert.equal(attempts.filter((a) => a.ok).length, 1);
    assert.equal(await prisma.appointment.count({ where: { clinicId, doctorId, startsAt, status: "BOOKED" } }), 1);
  });
});
