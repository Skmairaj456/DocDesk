import { ClinicRole } from "@prisma/client";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export class AuthenticationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type ClinicContext = {
  userId: string;
  authSubject: string;
  clinicId: string;
  role: ClinicRole;
  doctorProfileId: string | null;
};

export async function requireClinicUser(allowedRoles?: ClinicRole[]): Promise<ClinicContext> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    throw new AuthenticationError("Unable to verify the current sign-in.", 401);
  }
  if (!data.user) {
    throw new AuthenticationError("Sign in is required.", 401);
  }
  if (
    process.env.NODE_ENV === "production" &&
    process.env.DOC_DESK_ALLOW_DEMO_ACCOUNTS !== "enabled" &&
    data.user.email?.toLowerCase().endsWith("@docdesk.demo")
  ) {
    throw new AuthenticationError("Development demo accounts are not enabled in production.", 403);
  }

  const user = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.auth_subject', ${data.user.id}, true)`;
    return tx.user.findUnique({
      where: { authSubject: data.user.id },
      select: { id: true },
    });
  });
  if (!user) {
    throw new AuthenticationError("Your account has not been invited to a clinic.", 403);
  }

  const memberships = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.user_id', ${user.id}, true)`;
    return tx.membership.findMany({
      where: { userId: user.id, isActive: true },
      select: {
        id: true,
        clinicId: true,
        role: true,
      },
    });
  });
  if (memberships.length === 0) {
    throw new AuthenticationError("Your clinic membership is inactive or missing.", 403);
  }

  const cookieStore = await cookies();
  const requestedClinicId = cookieStore.get("docdesk-clinic")?.value;
  const membership = requestedClinicId
    ? memberships.find((entry) => entry.clinicId === requestedClinicId)
    : memberships.length === 1
      ? memberships[0]
      : undefined;
  if (!membership) {
    throw new AuthenticationError("Select a clinic membership before continuing.", 403);
  }
  if (allowedRoles && !allowedRoles.includes(membership.role)) {
    throw new AuthenticationError("Your clinic role does not allow this action.", 403);
  }
  const context: ClinicContext = {
    userId: user.id,
    authSubject: data.user.id,
    clinicId: membership.clinicId,
    role: membership.role,
    doctorProfileId: null,
  };
  if (membership.role === ClinicRole.DOCTOR) {
    const doctor = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.clinic_id', ${context.clinicId}, true)`;
      await tx.$queryRaw`SELECT set_config('app.user_id', ${context.userId}, true)`;
      return tx.doctorProfile.findFirst({
        where: { membershipId: membership.id, clinicId: context.clinicId },
        select: { id: true },
      });
    });
    if (!doctor) {
      throw new AuthenticationError("A doctor profile is required for this account.", 403);
    }
    context.doctorProfileId = doctor.id;
  }
  return context;
}
