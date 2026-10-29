import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { PrismaClient } from "@prisma/client";

const demoPassword = "DocDeskDemo!2026";
const clinicId = "00000000-0000-4000-8000-000000000001";
const accounts = [
  {
    userId: "00000000-0000-4000-8000-000000000022",
    email: "reception@docdesk.demo",
    displayName: "Maya Reddy",
    role: "RECEPTIONIST",
  },
  {
    userId: "00000000-0000-4000-8000-000000000023",
    email: "doctor@docdesk.demo",
    displayName: "Dr. Aditi Rao",
    role: "DOCTOR",
  },
];

if (process.env.NODE_ENV === "production") {
  throw new Error("Demo accounts can only be provisioned outside production.");
}
if (process.env.DOC_DESK_MODE !== "live") {
  throw new Error("Set DOC_DESK_MODE=live before provisioning demo accounts.");
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and the server-only SUPABASE_SERVICE_ROLE_KEY in .env.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});
const prisma = new PrismaClient();

async function findAuthUser(email) {
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Unable to list Supabase Auth users: ${error.message}`);
    const user = data.users.find((entry) => entry.email?.toLowerCase() === email);
    if (user) return user;
    if (data.users.length < 1000) return null;
  }
}

async function provisionAuthUser(account) {
  const existing = await findAuthUser(account.email);
  if (existing) {
    if (existing.user_metadata?.docdesk_demo !== true) {
      throw new Error(`${account.email} already exists and is not marked as a DocDesk demo account; refusing to change it.`);
    }
    const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
      password: demoPassword,
      email_confirm: true,
      user_metadata: { ...existing.user_metadata, docdesk_demo: true },
    });
    if (error) throw new Error(`Unable to update the demo Auth user ${account.email}: ${error.message}`);
    return data.user.id;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: account.email,
    password: demoPassword,
    email_confirm: true,
    user_metadata: { docdesk_demo: true },
  });
  if (error) throw new Error(`Unable to create the demo Auth user ${account.email}: ${error.message}`);
  if (!data.user) throw new Error(`Supabase did not return a user for ${account.email}.`);
  return data.user.id;
}

try {
  const linkedAccounts = [];
  for (const account of accounts) {
    linkedAccounts.push({ ...account, authSubject: await provisionAuthUser(account) });
  }

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.worker', 'true', true)`;

    for (const account of linkedAccounts) {
      const user = await tx.user.findUnique({
        where: { id: account.userId },
        select: { id: true },
      });
      if (!user) throw new Error("Demo staff records are missing. Run npm run db:seed first.");

      const membership = await tx.membership.findFirst({
        where: { clinicId, userId: user.id, role: account.role, isActive: true },
        select: { id: true },
      });
      if (!membership) throw new Error(`The seeded ${account.role.toLowerCase()} membership is missing.`);

      if (account.role === "DOCTOR") {
        const profile = await tx.doctorProfile.findUnique({
          where: { membershipId: membership.id },
          select: { id: true },
        });
        if (!profile) throw new Error("The seeded doctor profile is missing.");
      }

      await tx.user.update({
        where: { id: user.id },
        data: {
          authSubject: account.authSubject,
          email: account.email,
          displayName: account.displayName,
        },
      });
    }
  });

  console.log("Provisioned the development-only DocDesk doctor and receptionist accounts.");
} catch (error) {
  console.error("Demo account provisioning failed:", error instanceof Error ? error.message : "Unexpected error.");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
