import { AuthenticationError, requireClinicUser } from "@/lib/auth";
import { withClinic } from "@/lib/tenant-db";

export async function GET(_request: Request) {
  void _request.url;
  try {
    const context = await requireClinicUser();
    const resources = await withClinic(context, async (tx) => {
      const [departments, doctors] = await Promise.all([
        tx.department.findMany({
          where: { clinicId: context.clinicId, isActive: true },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
        tx.doctorProfile.findMany({
          where: { clinicId: context.clinicId, membership: { isActive: true } },
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
        departments,
        doctors: doctors.map((doctor) => ({
          id: doctor.id,
          name: doctor.membership.user.displayName,
          consultationMinutes: doctor.consultationMinutes,
          departmentIds: doctor.departments.map(({ departmentId }) => departmentId),
        })),
      };
    });
    return Response.json(resources);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("Unable to load clinic scheduling resources", error);
    return Response.json({ error: "Unable to load clinic scheduling resources." }, { status: 500 });
  }
}
