import { PrismaClient, ClinicRole, VisitType, AppointmentStatus, VisitOutcome } from "@prisma/client";

const prisma = new PrismaClient();

const id = {
  clinic: "00000000-0000-4000-8000-000000000001",
  departments: {
    cardiology: "00000000-0000-4000-8000-000000000011",
    dermatology: "00000000-0000-4000-8000-000000000012",
    general: "00000000-0000-4000-8000-000000000013",
  },
  users: {
    admin: "00000000-0000-4000-8000-000000000021",
    reception: "00000000-0000-4000-8000-000000000022",
    aditi: "00000000-0000-4000-8000-000000000023",
    neel: "00000000-0000-4000-8000-000000000024",
    sana: "00000000-0000-4000-8000-000000000025",
  },
  memberships: {
    admin: "00000000-0000-4000-8000-000000000031",
    reception: "00000000-0000-4000-8000-000000000032",
    aditi: "00000000-0000-4000-8000-000000000033",
    neel: "00000000-0000-4000-8000-000000000034",
    sana: "00000000-0000-4000-8000-000000000035",
  },
  doctors: {
    aditi: "00000000-0000-4000-8000-000000000041",
    neel: "00000000-0000-4000-8000-000000000042",
    sana: "00000000-0000-4000-8000-000000000043",
  },
  patients: [
    "00000000-0000-4000-8000-000000000051",
    "00000000-0000-4000-8000-000000000052",
    "00000000-0000-4000-8000-000000000053",
    "00000000-0000-4000-8000-000000000054",
    "00000000-0000-4000-8000-000000000055",
    "00000000-0000-4000-8000-000000000056",
  ],
  appointments: [
    "00000000-0000-4000-8000-000000000061",
    "00000000-0000-4000-8000-000000000062",
    "00000000-0000-4000-8000-000000000063",
    "00000000-0000-4000-8000-000000000064",
    "00000000-0000-4000-8000-000000000065",
    "00000000-0000-4000-8000-000000000066",
  ],
};

const clinic = {
  id: id.clinic,
  name: "Willow Health Clinic",
  timezone: "Asia/Kolkata",
  phone: "+91 4000000000",
  address: "12 Sample Road, Hyderabad",
};

const users = [
  { key: "admin", email: "admin@example.test", displayName: "Clinic Admin", role: ClinicRole.ADMIN },
  { key: "reception", email: "reception@docdesk.demo", displayName: "Maya Reddy", role: ClinicRole.RECEPTIONIST },
  { key: "aditi", email: "doctor@docdesk.demo", displayName: "Dr. Aditi Rao", role: ClinicRole.DOCTOR },
  { key: "neel", email: "neel@docdesk.demo", displayName: "Dr. Neel Shah", role: ClinicRole.DOCTOR },
  { key: "sana", email: "sana@docdesk.demo", displayName: "Dr. Sana Ali", role: ClinicRole.DOCTOR },
];

const departments = [
  { key: "cardiology", name: "Cardiology", code: "CARD" },
  { key: "dermatology", name: "Dermatology", code: "DERM" },
  { key: "general", name: "General medicine", code: "GEN" },
];

const patientData = [
  { fullName: "Ananya Rao", phone: "+91 98765 43210", dateOfBirth: "1992-04-16" },
  { fullName: "Rahul Mehta", phone: "+91 98201 45678", dateOfBirth: "1974-08-05" },
  { fullName: "Meera Iyer", phone: "+91 98450 11223", dateOfBirth: "1998-02-19" },
  { fullName: "Kabir Shah", phone: "+91 98190 33445", dateOfBirth: "1985-11-27" },
  { fullName: "Aarav Kapoor", phone: "+91 98990 56789", dateOfBirth: "2010-06-12" },
  { fullName: "Zoya Khan", phone: "+91 99887 66554", dateOfBirth: "1981-09-03" },
];

function localTime(hour, minute = 0) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: clinic.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type) => Number(parts.find((item) => item.type === type)?.value);
  return new Date(Date.UTC(part("year"), part("month") - 1, part("day"), hour - 5, minute - 30));
}

async function seed(db) {
  await db.clinic.upsert({ where: { id: clinic.id }, update: clinic, create: clinic });

  for (const user of users) {
    const userId = id.users[user.key];
    const membershipId = id.memberships[user.key];
    await db.user.upsert({
      where: { id: userId },
      update: { email: user.email, displayName: user.displayName },
      create: {
        id: userId,
        authSubject: userId,
        email: user.email,
        displayName: user.displayName,
      },
    });
    await db.membership.upsert({
      where: { id: membershipId },
      update: { role: user.role, isActive: true },
      create: { id: membershipId, clinicId: clinic.id, userId, role: user.role },
    });
  }

  for (const department of departments) {
    await db.department.upsert({
      where: { id: id.departments[department.key] },
      update: { name: department.name, code: department.code },
      create: { id: id.departments[department.key], clinicId: clinic.id, name: department.name, code: department.code },
    });
  }

  for (const [key, minutes] of [["aditi", 30], ["neel", 30], ["sana", 30]]) {
    await db.doctorProfile.upsert({
      where: { membershipId: id.memberships[key] },
      update: { consultationMinutes: minutes },
      create: {
        id: id.doctors[key],
        clinicId: clinic.id,
        membershipId: id.memberships[key],
        consultationMinutes: minutes,
      },
    });
  }

  await db.doctorDepartment.createMany({
    data: [
      { doctorId: id.doctors.aditi, departmentId: id.departments.cardiology },
      { doctorId: id.doctors.neel, departmentId: id.departments.dermatology },
      { doctorId: id.doctors.sana, departmentId: id.departments.general },
    ],
    skipDuplicates: true,
  });

  for (const doctorId of Object.values(id.doctors)) {
    for (const weekday of [1, 2, 3, 4, 5, 6]) {
      await db.doctorAvailability.upsert({
        where: { doctorId_weekday_startsAt: { doctorId, weekday, startsAt: "09:00" } },
        update: { endsAt: "17:00", isAvailable: true },
        create: { doctorId, weekday, startsAt: "09:00", endsAt: "17:00" },
      });
    }
  }

  const patients = [];
  for (const [index, patient] of patientData.entries()) {
    const normalizedPhone = patient.phone.replace(/\D/g, "");
    const normalizedName = patient.fullName.toLocaleLowerCase();
    patients.push(await db.patient.upsert({
      where: { id: id.patients[index] },
      update: { fullName: patient.fullName, normalizedName, phone: patient.phone, normalizedPhone },
      create: {
        id: id.patients[index],
        clinicId: clinic.id,
        fullName: patient.fullName,
        normalizedName,
        phone: patient.phone,
        normalizedPhone,
        dateOfBirth: new Date(`${patient.dateOfBirth}T00:00:00.000Z`),
      },
    }));
  }

  const appointments = [
    { patient: 0, doctor: "aditi", department: "cardiology", hour: 9, status: AppointmentStatus.ARRIVED, visitType: VisitType.FOLLOW_UP },
    { patient: 1, doctor: "aditi", department: "cardiology", hour: 9, minute: 30, status: AppointmentStatus.COMPLETED, visitType: VisitType.CONSULTATION },
    { patient: 2, doctor: "aditi", department: "cardiology", hour: 10, status: AppointmentStatus.BOOKED, visitType: VisitType.CONSULTATION },
    { patient: 3, doctor: "neel", department: "dermatology", hour: 10, minute: 30, status: AppointmentStatus.BOOKED, visitType: VisitType.CONSULTATION },
    { patient: 4, doctor: "neel", department: "dermatology", hour: 11, status: AppointmentStatus.BOOKED, visitType: VisitType.FOLLOW_UP },
    { patient: 5, doctor: "sana", department: "general", hour: 11, minute: 30, status: AppointmentStatus.BOOKED, visitType: VisitType.CONSULTATION },
  ];

  for (const [index, item] of appointments.entries()) {
    const startsAt = localTime(item.hour, item.minute ?? 0);
    const endsAt = new Date(startsAt.valueOf() + 30 * 60_000);
    const appointment = await db.appointment.upsert({
      where: { id: id.appointments[index] },
      update: { startsAt, endsAt, status: item.status, visitType: item.visitType },
      create: {
        id: id.appointments[index],
        clinicId: clinic.id,
        reference: `DD-SEED-${String(index + 1).padStart(3, "0")}`,
        patientId: patients[item.patient].id,
        doctorId: id.doctors[item.doctor],
        departmentId: id.departments[item.department],
        startsAt,
        endsAt,
        status: item.status,
        visitType: item.visitType,
      },
    });
    await db.scheduleBlock.upsert({
      where: { appointmentId: appointment.id },
      update: { startsAt, endsAt },
      create: { clinicId: clinic.id, doctorId: id.doctors[item.doctor], startsAt, endsAt, appointmentId: appointment.id },
    });
    if (item.status === AppointmentStatus.COMPLETED) {
      await db.consultation.upsert({
        where: { appointmentId: appointment.id },
        update: {},
        create: {
          clinicId: clinic.id,
          appointmentId: appointment.id,
          patientId: patients[item.patient].id,
          doctorId: id.doctors[item.doctor],
          note: "Fictional demo note: consultation completed and follow-up guidance reviewed with the patient.",
          outcome: VisitOutcome.STABLE,
          completedAt: new Date(endsAt.valueOf() + 60_000),
        },
      });
    }
  }

  console.log("Seeded Willow Health Clinic with fictional patients, staff, availability, and appointments.");
}

prisma.$transaction(async (tx) => {
  await tx.$queryRaw`SELECT set_config('app.worker', 'true', true)`;
  await seed(tx);
}, { timeout: 60_000, maxWait: 10_000 })
  .catch((error) => {
    console.error("Database seed failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
