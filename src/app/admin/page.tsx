import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { AdminPanel } from "@/components/AdminPanel";
import { adminConfigWarning, getAdminSession, isAdminConfigured } from "@/lib/admin";

// Never indexed and never cached: this page reads the admin cookie, so it must
// always render per-request and stay out of search engines entirely.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false, nocache: true },
};

export default async function AdminPage() {
  // Credentials are missing entirely, so nobody could ever sign in: show the
  // operator what to add rather than bouncing them to a login form that can
  // only fail.
  if (!isAdminConfigured()) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md glass-strong rounded-2xl p-6 space-y-3 text-sm animate-fade-up">
          <div className="flex items-center gap-2 text-lamp font-medium">
            <ShieldCheck className="w-4 h-4" />
            Admin access isn&apos;t configured yet
          </div>
          <p className="text-muted">
            Add these to <code className="text-ink">.env.local</code> (and to your hosting
            provider&apos;s environment variables), then restart the server:
          </p>
          <pre className="bg-black/40 border border-white/10 rounded-xl p-3 text-xs overflow-x-auto text-muted">
{`ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=your-password`}
          </pre>
          <p className="text-muted text-xs leading-relaxed">
            You then sign in with those credentials on the normal{" "}
            <Link href="/login" className="text-lamp hover:underline">
              login page
            </Link>
            . A plaintext password is all you need here — this file is gitignored and never shipped to
            the browser. Prefer a bcrypt hash? Set{" "}
            <code className="text-ink">ADMIN_PASSWORD_HASH</code> instead, but note that in{" "}
            <code className="text-ink">.env.local</code> every dollar sign must be preceded by a
            backslash: Next expands unescaped ones as variables and quietly shreds the hash. Paste the
            hash raw in your hosting provider&apos;s dashboard — that side does no expansion.
          </p>
          <pre className="bg-black/40 border border-white/10 rounded-xl p-3 text-xs overflow-x-auto text-muted">
{`node -e "console.log(require('bcryptjs').hashSync(process.argv[1],10))" 'your-password'`}
          </pre>
        </div>
      </div>
    );
  }

  // No admin cookie → the ordinary login page. If the visitor signs in with
  // the admin credentials there, it sends them straight back here.
  const session = await getAdminSession();
  if (!session) redirect("/login");

  return <AdminPanel admin={session.email} configWarning={adminConfigWarning()} />;
}
