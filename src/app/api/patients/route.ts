import { ClinicRole, Prisma } from "@prisma/client";
import { z } from "zod";
import { AuthenticationError, requireClinicUser } from "@/lib/auth";
import { withClinic } from "@/lib/tenant-db";

const patientInput = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(8).max(30),
  dateOfBirth: z.string().date().optional(),
  sex: z.enum(["FEMALE", "MALE", "OTHER", "NOT_SPECIFIED"]).optional(),
});

function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

export async function GET(request: Request) {
  try {
    const context = await requireClinicUser();
    const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 100) ?? "";
    const normalizedPhone = normalizePhone(query);
    const patients = await withClinic(context, (tx) =>
      tx.patient.findMany({
        where: {
          clinicId: context.clinicId,
          ...(context.doctorProfileId
            ? { appointments: { some: { doctorId: context.doctorProfileId } } }
            : {}),
          ...(query
            ? {
                OR: [
                  { normalizedName: { contains: query.toLocaleLowerCase(), mode: "insensitive" } },
                  ...(normalizedPhone ? [{ normalizedPhone: { contains: normalizedPhone } }] : []),
                ],
              }
            : {}),
        },
        select: {
          id: true,
          fullName: true,
          phone: true,
          dateOfBirth: true,
          registrationStatus: true,
          createdAt: true,
        },
        orderBy: { fullName: "asc" },
        take: 50,
      }),
    );
    return Response.json({ patients });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("Patient search failed", error);
    return Response.json({ error: "Unable to search patients." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireClinicUser([ClinicRole.ADMIN, ClinicRole.RECEPTIONIST]);
    const parsed = patientInput.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: "Invalid patient details.", details: parsed.error.flatten() }, { status: 400 });
    }
    const phone = normalizePhone(parsed.data.phone);
    const normalizedName = parsed.data.fullName.toLocaleLowerCase().replace(/\s+/g, " ");
    if (phone.length < 10) {
      return Response.json({ error: "Enter a valid phone number with at least 10 digits." }, { status: 400 });
    }

    const result = await withClinic(context, async (tx) => {
      const duplicate = await tx.patient.findFirst({
        where: { clinicId: context.clinicId, normalizedPhone: phone },
        select: { id: true, fullName: true },
      });
      if (duplicate) return { duplicate };

      const patient = await tx.patient.create({
        data: {
          clinicId: context.clinicId,
          fullName: parsed.data.fullName,
          normalizedName,
          phone: parsed.data.phone,
          normalizedPhone: phone,
          dateOfBirth: parsed.data.dateOfBirth ? new Date(`${parsed.data.dateOfBirth}T00:00:00.000Z`) : null,
          sex: parsed.data.sex,
        },
        select: { id: true, fullName: true, phone: true, dateOfBirth: true, createdAt: true },
      });
      await tx.auditLog.create({
        data: {
          clinicId: context.clinicId,
          userId: context.userId,
          action: "PATIENT_CREATED",
          entity: "Patient",
          entityId: patient.id,
        },
      });
      return { patient };
    });
    if ("duplicate" in result) {
      return Response.json({ error: "A patient with this phone number already exists.", possibleDuplicate: result.duplicate }, { status: 409 });
    }
    return Response.json({ patient: result.patient }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return Response.json({ error: "A patient with this phone number already exists." }, { status: 409 });
    }
    console.error("Patient registration failed", error);
    return Response.json({ error: "Unable to register patient." }, { status: 500 });
  }
}
