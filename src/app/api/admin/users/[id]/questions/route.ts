import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin";
import { getAdminUser, getAdminUserQuestions } from "@/lib/adminData";

// Drill-down endpoint: the questions (with the answer that followed each one)
// for ONE user, optionally filtered by `?q=`. Same gate as every other admin
// route — a valid `admin_session` cookie or nothing.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }

  try {
    const user = await getAdminUser(params.id);
    if (!user) {
      return NextResponse.json({ error: "That user no longer exists." }, { status: 404 });
    }

    const q = req.nextUrl.searchParams.get("q") ?? "";
    const questions = await getAdminUserQuestions(params.id, q);
    return NextResponse.json(
      { user, questions },
      // Per-user question content: same no-store rule as the overview.
      { headers: { "Cache-Control": "private, no-store, max-age=0" } }
    );
  } catch (err: any) {
    // Query details stay in the server log; the panel just sees a failure.
    console.error("Admin user questions failed:", err);
    return NextResponse.json(
      { error: "Couldn't load this user's questions — the database may be unreachable." },
      { status: 500 }
    );
  }
}
