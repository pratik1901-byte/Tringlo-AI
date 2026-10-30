// ============================================================
// Hospital — the provider directory, read from the hospital's system
// ============================================================
//
// Read-only, and that is the point. Tringlo does not create, edit, archive or
// delete a doctor: the hospital's own system owns its provider directory, and
// this endpoint reports what that system says, along with when it last said
// it and whether the last refresh worked.
//
// There is no POST, PUT or DELETE here, and none is coming. A hospital that
// wants a doctor's hours changed changes them where the rest of the hospital
// will see it.
// ============================================================

import { NextRequest, NextResponse } from "next/server";

import { requireHospitalAuth } from "@/lib/hospital/guard";
import { getAppointments } from "@/lib/db";
import { directoryStatus, providerDirectory, refreshProviderDirectory } from "@/lib/hospital/directory";
import { OPEN_APPOINTMENT_STATUSES } from "@/lib/hospital/types";

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const auth = await requireHospitalAuth(request);
  if (!auth.ok) return auth.response;

  // Asked for fresh, go and ask. Otherwise serve the copy, so opening the page
  // does not wait on somebody else's server.
  const wantsRefresh = new URL(request.url).searchParams.get("refresh") === "1";
  let refreshProblem: string | null = null;
  if (wantsRefresh) {
    const refreshed = await refreshProviderDirectory(auth.tenantId);
    if (!refreshed.ok) refreshProblem = refreshed.problem;
  }

  const directory = providerDirectory(auth.tenantId);
  const open = getAppointments(auth.tenantId).filter((appointment) =>
    OPEN_APPOINTMENT_STATUSES.includes(appointment.status)
  );

  return NextResponse.json(
    {
      providers: directory.providers.map((provider) => ({
        ...provider,
        // What Tringlo contributes: how many of this hospital's slots it has
        // booked. The schedule itself is the hospital's.
        upcoming: open.filter(
          (appointment) =>
            appointment.doctorId === provider.id && new Date(appointment.scheduledAt).getTime() >= Date.now()
        ).length,
      })),
      directory: directoryStatus(auth.tenantId),
      refreshProblem,
    },
    { headers: noStore }
  );
}
