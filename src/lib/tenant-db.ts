import type { Prisma } from "@prisma/client";
import type { ClinicContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function withClinic<T>(
  context: ClinicContext,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  options: { maxWait?: number; timeout?: number } = {},
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.clinic_id', ${context.clinicId}, true)`;
    await tx.$queryRaw`SELECT set_config('app.user_id', ${context.userId}, true)`;
    await tx.$queryRaw`SELECT set_config('app.auth_subject', ${context.authSubject}, true)`;
    return operation(tx);
  }, { maxWait: options.maxWait ?? 10_000, timeout: options.timeout ?? 15_000 });
}

export async function withWorker<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  options: { maxWait?: number; timeout?: number } = {},
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.worker', 'true', true)`;
    return operation(tx);
  }, { maxWait: options.maxWait ?? 10_000, timeout: options.timeout ?? 20_000 });
}
