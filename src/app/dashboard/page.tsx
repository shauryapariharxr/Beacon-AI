import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { DashboardClient } from "@/components/DashboardClient";

// The auth check runs on the SERVER before this page renders. A client-only
// check (fetch /api/auth/me → router.push) let browser Back/Forward serve the
// cached SPA shell of /dashboard after logout — the page painted, then bounced
// a moment later, which both looked broken and briefly exposed the signed-in
// UI. With the gate here, a back/forward navigation to /dashboard without a
// valid session never renders the dashboard at all: the server answers with a
// redirect to /login.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  return <DashboardClient />;
}
