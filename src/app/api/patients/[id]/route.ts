import { ClinicRole, Prisma } from "@prisma/client";
import { z } from "zod";
import { AuthenticationError, requireClinicUser } from "@/lib/auth";
import { withClinic } from "@/lib/tenant-db";

type Params = { params: Promise<{ id: string }> };

const patientUpdate = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(8).max(30),
  dateOfBirth: z.string().date().nullable(),
  sex: z.enum(["FEMALE", "MALE", "OTHER", "NOT_SPECIFIED"]).nullable(),
});

function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

// Reception profile: contact details and visit history only. Clinical notes stay in the doctor workspace.
const profileSelect = {
  id: true,
  fullName: true,
  phone: true,
  dateOfBirth: true,
  sex: true,
  registrationStatus: true,
  createdAt: true,
  appointments: {
    select: {
      id: true,
      reference: true,
      startsAt: true,
      status: true,
      visitType: true,
      source: true,
      department: { select: { name: true } },
      doctor: { select: { membership: { select: { user: { select: { displayName: true } } } } } },
    },
    orderBy: { startsAt: "desc" },
    take: 100,
  },
} satisfies Prisma.PatientSelect;

export async function GET(_request: Request, { params }: Params) {
  try {
    const context = await requireClinicUser([ClinicRole.ADMIN, ClinicRole.RECEPTIONIST]);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "Patient was not found." }, { status: 404 });
    const patient = await withClinic(context, (tx) =>
      tx.patient.findFirst({ where: { id, clinicId: context.clinicId }, select: profileSelect }),
    );
    if (!patient) return Response.json({ error: "Patient was not found." }, { status: 404 });
    return Response.json({ patient });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("Patient profile failed", error);
    return Response.json({ error: "Unable to load the patient profile." }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const context = await requireClinicUser([ClinicRole.ADMIN, ClinicRole.RECEPTIONIST]);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "Patient was not found." }, { status: 404 });
    const parsed = patientUpdate.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: "Invalid patient details.", details: parsed.error.flatten() }, { status: 400 });
    }
    const phone = normalizePhone(parsed.data.phone);
    if (phone.length < 10) {
      return Response.json({ error: "Enter a valid phone number with at least 10 digits." }, { status: 400 });
    }

    const result = await withClinic(context, async (tx) => {
      const existing = await tx.patient.findFirst({ where: { id, clinicId: context.clinicId }, select: { id: true } });
      if (!existing) return { missing: true as const };
      const duplicate = await tx.patient.findFirst({
        where: { clinicId: context.clinicId, normalizedPhone: phone, id: { not: id } },
        select: { id: true, fullName: true },
      });
      if (duplicate) return { duplicate };
      const patient = await tx.patient.update({
        where: { id },
        data: {
          fullName: parsed.data.fullName,
          normalizedName: parsed.data.fullName.toLocaleLowerCase().replace(/\s+/g, " "),
          phone: parsed.data.phone,
          normalizedPhone: phone,
          dateOfBirth: parsed.data.dateOfBirth ? new Date(`${parsed.data.dateOfBirth}T00:00:00.000Z`) : null,
          sex: parsed.data.sex,
        },
        select: profileSelect,
      });
      await tx.auditLog.create({
        data: {
          clinicId: context.clinicId,
          userId: context.userId,
          action: "PATIENT_UPDATED",
          entity: "Patient",
          entityId: id,
        },
      });
      return { patient };
    });
    if ("missing" in result) return Response.json({ error: "Patient was not found." }, { status: 404 });
    if ("duplicate" in result) {
      return Response.json({ error: `Another patient (${result.duplicate?.fullName}) already uses this phone number.` }, { status: 409 });
    }
    return Response.json({ patient: result.patient });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("Patient update failed", error);
    return Response.json({ error: "Unable to update the patient." }, { status: 500 });
  }
}
