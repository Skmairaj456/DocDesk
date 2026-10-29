import { connection } from "next/server";
import { notFound, redirect } from "next/navigation";
import { ClinicRole } from "@prisma/client";
import { AuthenticationError, requireClinicUser } from "@/lib/auth";
import SimulatorChat from "@/components/simulator-chat";

export const instant = false;

export default async function SimulatorPage() {
  await connection();
  if (process.env.NODE_ENV === "production" && process.env.DOC_DESK_SIMULATOR !== "enabled") notFound();
  try {
    await requireClinicUser([ClinicRole.ADMIN, ClinicRole.RECEPTIONIST]);
  } catch (error) {
    if (error instanceof AuthenticationError && error.status === 401) redirect("/login");
    notFound();
  }
  return <SimulatorChat />;
}
