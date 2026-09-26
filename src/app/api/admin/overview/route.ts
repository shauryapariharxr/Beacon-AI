import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin";
import { getAdminOverview } from "@/lib/adminData";

// The panel's landing call: stats + the user list, optionally filtered by
// `?q=` (matches email or name). Questions are NOT included — they are loaded
// one user at a time from /api/admin/users/[id]/questions. Rejects anything
// without a valid admin cookie.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }

  try {
    const q = req.nextUrl.searchParams.get("q") ?? "";
    const overview = await getAdminOverview(q);
    return NextResponse.json(
      { ...overview, adminEmail: session.email },
      // Admin responses carry per-user data: never let a shared cache, a
      // service worker or the browser's back/forward cache hold onto them.
      { headers: { "Cache-Control": "private, no-store, max-age=0" } }
    );
  } catch (err: any) {
    // Query details stay in the server log; the panel just sees a failure.
    console.error("Admin overview failed:", err);
    return NextResponse.json(
      { error: "Couldn't load admin data — the database may be unreachable." },
      { status: 500 }
    );
  }
}
