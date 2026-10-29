import "dotenv/config";
import { randomUUID } from "node:crypto";
import { ClinicRole, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const required = ["SUPABASE_AUTH_SUBJECT", "USER_EMAIL", "USER_NAME", "CLINIC_ID", "CLINIC_ROLE"];
const missing = required.filter((name) => !process.env[name]);

if (missing.length) {
  throw new Error(`Set the required user-linking variables: ${missing.join(", ")}`);
}

const authSubject = process.env.SUPABASE_AUTH_SUBJECT;
const clinicId = process.env.CLINIC_ID;
const role = process.env.CLINIC_ROLE;
if (!/^[0-9a-f-]{36}$/i.test(authSubject) || !/^[0-9a-f-]{36}$/i.test(clinicId)) {
  throw new Error("SUPABASE_AUTH_SUBJECT and CLINIC_ID must be UUIDs.");
}
if (!Object.values(ClinicRole).includes(role)) {
  throw new Error("CLINIC_ROLE must be ADMIN, RECEPTIONIST, or DOCTOR.");
}

const departmentIds = (process.env.DOCTOR_DEPARTMENT_IDS ?? "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

try {
  const user = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.worker', 'true', true)`;
    const clinic = await tx.clinic.findUnique({ where: { id: clinicId }, select: { id: true } });
    if (!clinic) throw new Error("CLINIC_ID does not identify an existing clinic.");

    const linkedUser = await tx.user.upsert({
      where: { authSubject },
      update: { email: process.env.USER_EMAIL, displayName: process.env.USER_NAME },
      create: {
        id: randomUUID(),
        authSubject,
        email: process.env.USER_EMAIL,
        displayName: process.env.USER_NAME,
      },
    });
    const membership = await tx.membership.upsert({
      where: { clinicId_userId: { clinicId, userId: linkedUser.id } },
      update: { role, isActive: true },
      create: { clinicId, userId: linkedUser.id, role },
    });

    if (role === ClinicRole.DOCTOR) {
      const departments = await tx.department.findMany({
        where: { clinicId, id: { in: departmentIds }, isActive: true },
        select: { id: true },
      });
      if (departments.length !== departmentIds.length || departmentIds.length === 0) {
        throw new Error("A doctor requires one or more active department IDs from this clinic.");
      }
      const profile = await tx.doctorProfile.upsert({
        where: { membershipId: membership.id },
        update: { clinicId },
        create: { clinicId, membershipId: membership.id },
      });
      await tx.doctorDepartment.createMany({
        data: departmentIds.map((departmentId) => ({ doctorId: profile.id, departmentId })),
        skipDuplicates: true,
      });
    }
    return linkedUser;
  });
  console.log(`Linked ${user.email} to clinic ${clinicId} as ${role}.`);
} catch (error) {
  console.error("Clinic user linking failed", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
