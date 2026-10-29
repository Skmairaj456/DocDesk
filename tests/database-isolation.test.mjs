import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

const testDatabaseUrl = process.env.DOC_DESK_TEST_DATABASE_URL;

function validateTestDatabaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DOC_DESK_TEST_DATABASE_URL must be a valid PostgreSQL URL.");
  }

  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error("Database isolation tests only run against a loopback PostgreSQL server.");
  }
  if (!/(?:^|[_-])test$/i.test(databaseName)) {
    throw new Error("The test database name must end in '_test' or '-test'.");
  }

  return url.toString();
}

test("runtime role enforces clinic isolation for patients and consultation notes", {
  skip: !testDatabaseUrl,
}, async () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: validateTestDatabaseUrl(testDatabaseUrl) } },
  });
  const rollback = new Error("rollback database isolation fixtures");

  try {
    await prisma.$transaction(async (tx) => {
      const roleRows = await tx.$queryRaw`
        WITH RECURSIVE reachable_roles(role_oid) AS (
          SELECT oid FROM pg_roles WHERE rolname = current_user
          UNION
          SELECT membership.roleid
          FROM pg_auth_members membership
          JOIN reachable_roles reachable ON reachable.role_oid = membership.member
        )
        SELECT
          bool_or(role.rolsuper) AS has_superuser,
          bool_or(role.rolbypassrls) AS has_bypassrls,
          bool_or(EXISTS (
            SELECT 1
            FROM pg_class relation
            JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname = 'public'
              AND relation.relrowsecurity
              AND relation.relowner = role.oid
          )) AS owns_rls_tables
        FROM reachable_roles reachable
        JOIN pg_roles role ON role.oid = reachable.role_oid
      `;
      assert.equal(roleRows[0].has_superuser, false, "runtime role must not be or inherit a superuser role");
      assert.equal(roleRows[0].has_bypassrls, false, "runtime role must not bypass or inherit BYPASSRLS");
      assert.equal(roleRows[0].owns_rls_tables, false, "runtime role must not own or inherit ownership of RLS-protected tables");
      const rlsRows = await tx.$queryRaw`
        SELECT relation.relname, relation.relrowsecurity, relation.relforcerowsecurity
        FROM pg_class relation
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND relation.relname IN ('Patient', 'Consultation')
      `;
      assert.equal(rlsRows.length, 2, "patient and consultation tables must exist");
      for (const row of rlsRows) {
        assert.equal(row.relrowsecurity, true, `${row.relname} must have RLS enabled`);
        assert.equal(row.relforcerowsecurity, true, `${row.relname} must force RLS`);
      }

      const clinicA = randomUUID();
      const clinicB = randomUUID();
      const userA = randomUUID();
      const userB = randomUUID();
      const membershipA = randomUUID();
      const membershipB = randomUUID();
      const doctorA = randomUUID();
      const doctorB = randomUUID();
      const departmentA = randomUUID();
      const departmentB = randomUUID();
      const patientA = randomUUID();
      const patientB = randomUUID();
      const appointmentA = randomUUID();
      const appointmentB = randomUUID();
      const consultationA = randomUUID();
      const consultationB = randomUUID();
      const startsAt = new Date("2030-01-01T09:00:00.000Z");
      const endsAt = new Date("2030-01-01T09:30:00.000Z");

      await tx.$queryRaw`SELECT set_config('app.worker', 'true', true)`;
      await tx.clinic.createMany({
        data: [
          { id: clinicA, name: "Isolation test clinic A" },
          { id: clinicB, name: "Isolation test clinic B" },
        ],
      });
      await tx.user.createMany({
        data: [
          { id: userA, authSubject: randomUUID(), email: `${userA}@example.test`, displayName: "Test Doctor A" },
          { id: userB, authSubject: randomUUID(), email: `${userB}@example.test`, displayName: "Test Doctor B" },
        ],
      });
      await tx.membership.createMany({
        data: [
          { id: membershipA, clinicId: clinicA, userId: userA, role: "DOCTOR" },
          { id: membershipB, clinicId: clinicB, userId: userB, role: "DOCTOR" },
        ],
      });
      await tx.doctorProfile.createMany({
        data: [
          { id: doctorA, clinicId: clinicA, membershipId: membershipA },
          { id: doctorB, clinicId: clinicB, membershipId: membershipB },
        ],
      });
      await tx.department.createMany({
        data: [
          { id: departmentA, clinicId: clinicA, name: "Test department A" },
          { id: departmentB, clinicId: clinicB, name: "Test department B" },
        ],
      });
      await tx.patient.createMany({
        data: [
          { id: patientA, clinicId: clinicA, fullName: "Fictional Patient A", normalizedName: "fictional patient a", phone: "+10000000001", normalizedPhone: "+10000000001" },
          { id: patientB, clinicId: clinicB, fullName: "Fictional Patient B", normalizedName: "fictional patient b", phone: "+10000000002", normalizedPhone: "+10000000002" },
        ],
      });
      await tx.appointment.createMany({
        data: [
          { id: appointmentA, clinicId: clinicA, reference: `ISO-${appointmentA}`, patientId: patientA, departmentId: departmentA, doctorId: doctorA, startsAt, endsAt },
          { id: appointmentB, clinicId: clinicB, reference: `ISO-${appointmentB}`, patientId: patientB, departmentId: departmentB, doctorId: doctorB, startsAt, endsAt },
        ],
      });
      await tx.consultation.createMany({
        data: [
          { id: consultationA, clinicId: clinicA, appointmentId: appointmentA, patientId: patientA, doctorId: doctorA, note: "Fictional private note A" },
          { id: consultationB, clinicId: clinicB, appointmentId: appointmentB, patientId: patientB, doctorId: doctorB, note: "Fictional private note B" },
        ],
      });

      await tx.$queryRaw`SELECT set_config('app.worker', 'false', true)`;
      await tx.$queryRaw`SELECT set_config('app.clinic_id', ${clinicA}, true)`;
      assert.ok(await tx.patient.findUnique({ where: { id: patientA } }), "clinic A can read its patient");
      assert.equal(await tx.patient.findUnique({ where: { id: patientB } }), null, "clinic A cannot read clinic B patient");
      const patientWrite = await tx.patient.updateMany({
        where: { id: patientB },
        data: { fullName: "Unauthorized change" },
      });
      assert.equal(patientWrite.count, 0, "clinic A cannot update clinic B patient");
      assert.equal(
        await tx.consultation.findUnique({ where: { id: consultationB } }),
        null,
        "clinic A cannot read clinic B consultation",
      );
      const consultationWrite = await tx.consultation.updateMany({
        where: { id: consultationB },
        data: { note: "Unauthorized note change" },
      });
      assert.equal(consultationWrite.count, 0, "clinic A cannot update clinic B consultation");

      await tx.$queryRaw`SELECT set_config('app.clinic_id', ${clinicB}, true)`;
      assert.ok(await tx.patient.findUnique({ where: { id: patientB } }), "clinic B can read its patient");
      assert.equal(await tx.patient.findUnique({ where: { id: patientA } }), null, "clinic B cannot read clinic A patient");
      assert.equal(
        await tx.consultation.findUnique({ where: { id: consultationA } }),
        null,
        "clinic B cannot read clinic A consultation",
      );
      assert.equal(
        (await tx.consultation.findUnique({ where: { id: consultationB } })).note,
        "Fictional private note B",
        "clinic B's note is unchanged by clinic A's attempted update",
      );

      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    await prisma.$disconnect();
  }
});
