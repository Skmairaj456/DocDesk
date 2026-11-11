import { ClinicRole } from "@prisma/client";
import { z } from "zod";
import { AuthenticationError, requireClinicUser } from "@/lib/auth";
import { loadSchedulePool, slotsForDate } from "@/lib/booking-service";
import { withClinic } from "@/lib/tenant-db";
import { sessionOfInstant } from "@/lib/whatsapp/sessions";

// Free times for one doctor on one day, computed the same way as the WhatsApp booking flow
// (working hours, leave, booked appointments and active holds).
const query = z.object({
  doctorId: z.string().uuid(),
  departmentId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function GET(request: Request) {
  // Reading the URL first marks the route as request-time, so it is never prerendered.
  const searchParams = new URL(request.url).searchParams;
  try {
    const context = await requireClinicUser([ClinicRole.ADMIN, ClinicRole.RECEPTIONIST, ClinicRole.DOCTOR]);
    const parsed = query.safeParse(Object.fromEntries(searchParams));
    if (!parsed.success) return Response.json({ error: "Choose a doctor, department and date." }, { status: 400 });
    const { doctorId, departmentId, date } = parsed.data;
    const now = new Date();
    const result = await withClinic(context, async (tx) => {
      const pool = await loadSchedulePool(tx, { clinicId: context.clinicId, departmentId, doctorId, fromDate: date, days: 1, now });
      if (pool.doctors.length === 0) return null;
      return slotsForDate(pool, date, now).map((slot) => ({
        startsAt: slot.startsAt.toISOString(),
        endsAt: slot.endsAt.toISOString(),
        session: sessionOfInstant(slot.startsAt, pool.timezone),
      }));
    });
    if (!result) return Response.json({ error: "This doctor is not available in that department." }, { status: 404 });
    return Response.json({ slots: result });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Unable to load free slots", error);
    return Response.json({ error: "Unable to load free times." }, { status: 500 });
  }
}
