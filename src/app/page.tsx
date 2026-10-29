import { connection } from "next/server";
import { redirect } from "next/navigation";
import { AppointmentStatus } from "@prisma/client";
import { AuthenticationError, requireClinicUser } from "@/lib/auth";
import { localDayBounds, clinicLocalDate } from "@/lib/booking-time.mjs";
import { withClinic } from "@/lib/tenant-db";
import DocDeskDashboard from "@/components/docdesk-dashboard";
import DoctorWorkspace from "@/components/doctor-workspace";
import LiveClinicWorkspace from "@/components/live-clinic-workspace";

export const instant = false;

export default async function Home() {
  await connection();
  if (process.env.NODE_ENV !== "production" && process.env.DOC_DESK_MODE !== "live") {
    return <DocDeskDashboard />;
  }

  if (
    !process.env.DATABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return <SetupRequired />;
  }

  let context;
  try {
    context = await requireClinicUser();
  } catch (error) {
    if (error instanceof AuthenticationError && error.status === 401) redirect("/login");
    if (error instanceof AuthenticationError && error.status === 403) return <AccessRequired />;
    throw error;
  }

  const data = await withClinic(context, async (tx) => {
    const clinic = await tx.clinic.findUnique({
      where: { id: context.clinicId },
      select: { name: true, timezone: true },
    });
    if (!clinic) throw new Error("The selected clinic no longer exists.");

    const localDate = clinicLocalDate(new Date(), clinic.timezone);
    const { start, end } = localDayBounds(localDate, clinic.timezone);
    const [appointments, patients, departments, doctors] = await Promise.all([
      tx.appointment.findMany({
        where: {
          clinicId: context.clinicId,
          startsAt: { gte: start, lt: end },
          ...(context.doctorProfileId
            ? { doctorId: context.doctorProfileId, status: { not: AppointmentStatus.CANCELLED } }
            : {}),
        },
        select: {
          id: true,
          reference: true,
          startsAt: true,
          endsAt: true,
          status: true,
          visitType: true,
          patient: { select: { id: true, fullName: true } },
          doctor: { select: { membership: { select: { user: { select: { displayName: true } } } } } },
          department: { select: { name: true } },
        },
        orderBy: { startsAt: "asc" },
      }),
      tx.patient.findMany({
        where: {
          clinicId: context.clinicId,
          ...(context.doctorProfileId
            ? { appointments: { some: { doctorId: context.doctorProfileId } } }
            : {}),
        },
        select: { id: true, fullName: true, phone: true, dateOfBirth: true },
        orderBy: { fullName: "asc" },
        take: 100,
      }),
      tx.department.findMany({
        where: { clinicId: context.clinicId, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      tx.doctorProfile.findMany({
        where: {
          clinicId: context.clinicId,
          membership: { isActive: true },
          ...(context.doctorProfileId ? { id: context.doctorProfileId } : {}),
        },
        select: {
          id: true,
          consultationMinutes: true,
          membership: { select: { user: { select: { displayName: true } } } },
          departments: { select: { departmentId: true } },
        },
        orderBy: { membership: { user: { displayName: "asc" } } },
      }),
    ]);

    return {
      clinicName: clinic.name,
      timezone: clinic.timezone,
      role: context.role,
      localDate,
      appointments: appointments.map((appointment) => ({
        ...appointment,
        startsAt: appointment.startsAt.toISOString(),
        endsAt: appointment.endsAt.toISOString(),
      })),
      patients: patients.map((patient) => ({
        ...patient,
        dateOfBirth: patient.dateOfBirth?.toISOString() ?? null,
      })),
      departments,
      doctors: doctors.map((doctor) => ({
        id: doctor.id,
        name: doctor.membership.user.displayName,
        consultationMinutes: doctor.consultationMinutes,
        departmentIds: doctor.departments.map(({ departmentId }) => departmentId),
      })),
    };
  }, { timeout: 15_000 });

  if (context.doctorProfileId) {
    return <DoctorWorkspace {...data} />;
  }

  return <LiveClinicWorkspace {...data} />;
}

function SetupRequired() {
  return (
    <main className="setup-screen">
      <div className="setup-card">
        <span className="brand-mark">d.</span>
        <p className="eyebrow">DOC DESK · SETUP REQUIRED</p>
        <h1>Connect your clinic workspace</h1>
        <p>
          Live clinic access requires Supabase Auth and PostgreSQL. Configure
          the server environment and migrations before patient records can be
          opened. The sample simulator is disabled in production.
        </p>
        <div className="setup-actions">
          <a className="button button-outline" href="/setup">Setup instructions</a>
          <a className="button button-primary" href="/login">Sign in</a>
        </div>
      </div>
    </main>
  );
}

function AccessRequired() {
  return (
    <main className="setup-screen">
      <div className="setup-card">
        <span className="brand-mark">d.</span>
        <p className="eyebrow">CLINIC ACCESS</p>
        <h1>Clinic membership required</h1>
        <p>Your authenticated account is not linked to an active clinic membership. Ask a clinic administrator to provision access.</p>
        <form action="/auth/sign-out" method="post"><button className="button button-primary">Sign out</button></form>
      </div>
    </main>
  );
}
