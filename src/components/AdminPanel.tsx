"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  Activity,
  ArrowLeft,
  Bot,
  Brain,
  ChevronDown,
  ChevronRight,
  FileText,
  HelpCircle,
  Loader2,
  LogOut,
  MessageSquare,
  RefreshCw,
  Search,
  Users,
} from "lucide-react";
import { ConfirmLogoutDialog } from "./ConfirmLogoutDialog";
import { useBackLogoutGuard } from "@/lib/useBackLogoutGuard";
import { hardLogout } from "@/lib/hardLogout";

type AdminStats = {
  totalUsers: number;
  newUsers24h: number;
  newUsers7d: number;
  activeUsers24h: number;
  activeUsers7d: number;
  totalConversations: number;
  totalQuestions: number;
  totalReplies: number;
  questions24h: number;
  questions7d: number;
  totalDocuments: number;
  totalMemories: number;
};

type AdminUserRow = {
  id: string;
  email: string;
  name: string | null;
  createdAt: number;
  conversations: number;
  questions: number;
  lastActiveAt: number | null;
};

type AdminQuestionRow = {
  id: string;
  content: string;
  createdAt: number;
  conversationId: string;
  model: string;
  answer: string | null;
};

type Overview = { stats: AdminStats; users: AdminUserRow[] };

const NUM = new Intl.NumberFormat("en-IN");

function timeAgo(ts: number | null): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

async function safeJson(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-center gap-2 text-muted">
        <Icon className="w-4 h-4" />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold text-ink tabular-nums">{NUM.format(value)}</div>
      <div className="mt-0.5 text-xs text-muted">{hint}</div>
    </div>
  );
}

export function AdminPanel({
  admin,
  configWarning,
}: {
  admin: string;
  configWarning?: string | null;
}) {
  const router = useRouter();

  // Landing data: site stats + the people using Beacon. Questions are never
  // loaded here — that only happens after a specific user is opened.
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // Drill-down state: the user whose questions are on screen, plus their
  // questions and an independent search over just those.
  const [selected, setSelected] = useState<AdminUserRow | null>(null);
  const [questions, setQuestions] = useState<AdminQuestionRow[] | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailQuery, setDetailQuery] = useState("");
  const [debouncedDetailQuery, setDebouncedDetailQuery] = useState("");
  const [openAnswers, setOpenAnswers] = useState<Set<string>>(new Set());
  // Same guard as the user side: one modal between the click and the session
  // ending, so a stray tap on the header can't sign the operator out.
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  // Same guard as the user sidebar: the Beacon mark used to be a plain link
  // to "/" that silently ended the operator's session.
  const [confirmHome, setConfirmHome] = useState(false);
  // Browser Back on the admin panel asks before ending the session too.
  const { confirming: backConfirming, settle: settleBackGuard } = useBackLogoutGuard();

  const load = useCallback(
    async (q: string) => {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/overview${q ? `?q=${encodeURIComponent(q)}` : ""}`);
        // The admin cookie expired while the tab sat open — back to the
        // ordinary login page, where signing in as admin returns you here.
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        const json = await safeJson(res);
        if (!res.ok) {
          setError(json.error || "Couldn't load admin data.");
          return;
        }
        setError(null);
        setData({ stats: json.stats, users: json.users ?? [] });
      } catch {
        setError("Couldn't reach the server — check your connection and retry.");
      } finally {
        setLoading(false);
      }
    },
    [router]
  );

  useEffect(() => {
    load(debouncedQuery);
  }, [debouncedQuery, load]);

  // Debounce both search boxes so typing doesn't hammer the database.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedDetailQuery(detailQuery.trim()), 350);
    return () => clearTimeout(t);
  }, [detailQuery]);

  // Fetch one user's questions whenever the open user changes, or when their
  // own search term changes. `stale` guards against a slow response for a user
  // you have already navigated away from.
  useEffect(() => {
    if (!selected) return;
    let stale = false;
    (async () => {
      setDetailLoading(true);
      try {
        const url = `/api/admin/users/${encodeURIComponent(selected.id)}/questions${
          debouncedDetailQuery ? `?q=${encodeURIComponent(debouncedDetailQuery)}` : ""
        }`;
        const res = await fetch(url);
        if (stale) return;
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        const json = await safeJson(res);
        if (!res.ok) {
          setDetailError(json.error || "Couldn't load this user's questions.");
          setQuestions([]);
          return;
        }
        setDetailError(null);
        setQuestions(json.questions ?? []);
      } catch {
        if (!stale) {
          setDetailError("Couldn't reach the server — check your connection and retry.");
          setQuestions([]);
        }
      } finally {
        if (!stale) setDetailLoading(false);
      }
    })();
    return () => {
      stale = true;
    };
  }, [selected, debouncedDetailQuery, router]);

  async function signOut() {
    setLoggingOut(true);
    try {
      // Hard navigation (see hardLogout): the admin shell must not survive in
      // history or the back/forward cache after the session ends.
      await hardLogout("/api/admin/logout", "/login");
    } finally {
      setLoggingOut(false);
    }
  }

  function openUser(user: AdminUserRow) {
    setSelected(user);
    setQuestions(null);
    setDetailError(null);
    setDetailQuery("");
    setDebouncedDetailQuery("");
    setOpenAnswers(new Set());
  }

  function closeUser() {
    setSelected(null);
    setQuestions(null);
    setDetailError(null);
    setDetailQuery("");
    setDebouncedDetailQuery("");
  }

  function toggleAnswer(id: string) {
    setOpenAnswers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const stats = data?.stats;
  const cards = stats
    ? [
        {
          icon: Users,
          label: "Total users",
          value: stats.totalUsers,
          hint: `+${NUM.format(stats.newUsers24h)} today · +${NUM.format(stats.newUsers7d)} this week`,
        },
        {
          icon: Activity,
          label: "Active chatters (7d)",
          value: stats.activeUsers7d,
          hint: `${NUM.format(stats.activeUsers24h)} in the last 24h`,
        },
        {
          icon: MessageSquare,
          label: "Conversations",
          value: stats.totalConversations,
          hint: "all time",
        },
        {
          icon: HelpCircle,
          label: "Questions asked",
          value: stats.totalQuestions,
          hint: `${NUM.format(stats.questions24h)} today · ${NUM.format(stats.questions7d)} this week`,
        },
        {
          icon: Bot,
          label: "Answers sent",
          value: stats.totalReplies,
          hint: "assistant replies",
        },
        {
          icon: FileText,
          label: "Documents",
          value: stats.totalDocuments,
          hint: "uploaded for grounded answers",
        },
        {
          icon: Brain,
          label: "Memories",
          value: stats.totalMemories,
          hint: "long-term notes remembered",
        },
      ]
    : [];

  return (
    <div className="min-h-screen pb-16">
      <header className="sticky top-0 z-40 glass-nav border-b border-white/10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => setConfirmHome(true)}
            aria-label="Beacon home — opens the log out confirmation"
            title="Log out"
            className="flex items-center gap-2 rounded-lg hover:bg-white/[0.05] transition-colors px-1.5 py-1 -mx-1.5"
          >
            <Image src="/logo.svg" alt="" width={26} height={26} />
            <span className="font-serif font-semibold">Beacon</span>
          </button>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-lamp/15 text-lamp border border-lamp/30 font-medium">
            ADMIN
          </span>
          <span className="ml-auto hidden sm:block text-xs text-muted truncate max-w-[200px]">{admin}</span>
          <button
            onClick={() => (selected ? closeUser() : load(debouncedQuery))}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-muted hover:text-ink border border-white/10 rounded-lg px-2.5 py-1.5 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            onClick={() => setConfirmLogout(true)}
            className="flex items-center gap-1.5 text-xs text-muted hover:text-red-400 border border-white/10 rounded-lg px-2.5 py-1.5 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign out
          </button>
        </div>
      </header>

      <ConfirmLogoutDialog
        open={confirmLogout || confirmHome || backConfirming}
        busy={loggingOut}
        onCancel={() => {
          setConfirmLogout(false);
          setConfirmHome(false);
          settleBackGuard(false);
        }}
        onConfirm={signOut}
      />

      <main className="max-w-6xl mx-auto px-4 pt-6 space-y-8">
        {configWarning && !selected && (
          // Without this the operator only ever sees "Invalid email or
          // password" and has no way to tell a typo from a broken env var.
          <div className="text-xs text-amber-300/90 bg-amber-400/10 border border-amber-400/25 rounded-xl p-3 leading-relaxed">
            <span className="font-semibold">Credential problem: </span>
            {configWarning}
          </div>
        )}

        {error && <div className="glass rounded-xl p-3 text-sm text-red-400 animate-toast-in">{error}</div>}

        {!selected && loading && !data && (
          <div className="flex items-center justify-center gap-2 py-24 text-muted">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading site data…</span>
          </div>
        )}

        {/* ---------- One user's questions ---------- */}
        {selected && (
          <section className="animate-fade-up space-y-4">
            <button
              onClick={closeUser}
              className="flex items-center gap-1.5 text-sm text-muted hover:text-ink transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              All users
            </button>

            <div className="glass-strong rounded-2xl p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <h1 className="font-serif font-semibold text-xl truncate">
                    {selected.name || selected.email.split("@")[0]}
                  </h1>
                  <p className="text-sm text-muted truncate">{selected.email}</p>
                </div>
                <div className="flex gap-6 text-xs text-muted">
                  <div>
                    <div className="uppercase tracking-wide">Chats</div>
                    <div className="mt-0.5 text-base text-ink tabular-nums">
                      {NUM.format(selected.conversations)}
                    </div>
                  </div>
                  <div>
                    <div className="uppercase tracking-wide">Questions</div>
                    <div className="mt-0.5 text-base text-ink tabular-nums">
                      {NUM.format(selected.questions)}
                    </div>
                  </div>
                  <div>
                    <div className="uppercase tracking-wide">Joined</div>
                    <div className="mt-0.5 text-base text-ink whitespace-nowrap">
                      {formatDate(selected.createdAt)}
                    </div>
                  </div>
                  <div>
                    <div className="uppercase tracking-wide">Last active</div>
                    <div className="mt-0.5 text-base text-ink whitespace-nowrap">
                      {timeAgo(selected.lastActiveAt)}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <h2 className="font-serif font-semibold text-lg whitespace-nowrap">Questions</h2>
              <div className="relative ml-auto w-full max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted" />
                <input
                  value={detailQuery}
                  onChange={(e) => setDetailQuery(e.target.value)}
                  placeholder="Search this user's questions…"
                  className="w-full bg-black/20 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-lamp"
                />
              </div>
            </div>

            {detailError && (
              <div className="glass rounded-xl p-3 text-sm text-red-400 animate-toast-in">{detailError}</div>
            )}

            {detailLoading && questions === null ? (
              <div className="flex items-center justify-center gap-2 py-16 text-muted">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">Loading questions…</span>
              </div>
            ) : (
              <div className={`space-y-2 ${detailLoading ? "opacity-60 transition-opacity" : ""}`}>
                {(questions?.length ?? 0) === 0 && !detailError && (
                  <p className="glass rounded-xl p-4 text-sm text-muted">
                    {detailQuery.trim()
                      ? "No questions from this user match that search."
                      : "This user hasn't asked anything yet."}
                  </p>
                )}
                {questions?.map((q) => {
                  const open = openAnswers.has(q.id);
                  return (
                    <div key={q.id} className="glass rounded-xl p-4">
                      <p className="text-sm text-ink whitespace-pre-wrap break-words">{q.content}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                        <span className="uppercase">{q.model}</span>
                        <span aria-hidden>·</span>
                        <span>{timeAgo(q.createdAt)}</span>
                        {q.answer && (
                          <button
                            onClick={() => toggleAnswer(q.id)}
                            className="ml-auto flex items-center gap-1 text-muted hover:text-ink transition-colors"
                          >
                            {open ? "Hide answer" : "Show answer"}
                            <ChevronDown
                              className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`}
                            />
                          </button>
                        )}
                      </div>
                      {q.answer && (
                        <p
                          className={`mt-2 text-xs text-muted whitespace-pre-wrap break-words border-l-2 border-lamp/30 pl-3 ${
                            open ? "" : "line-clamp-2"
                          }`}
                        >
                          {q.answer}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* ---------- Overview + every user ---------- */}
        {!selected && stats && (
          <>
            <section className="animate-fade-up">
              <h2 className="font-serif font-semibold text-lg mb-3">Overview</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {cards.map((c) => (
                  <StatCard key={c.label} icon={c.icon} label={c.label} value={c.value} hint={c.hint} />
                ))}
              </div>
            </section>

            <section className="animate-fade-up" style={{ animationDelay: "80ms" }}>
              <div className="flex items-center gap-3 mb-3">
                <h2 className="font-serif font-semibold text-lg whitespace-nowrap">Users</h2>
                <span className="text-xs text-muted">{NUM.format(data!.users.length)} accounts</span>
                <div className="relative ml-auto w-full max-w-xs">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search users…"
                    className="w-full bg-black/20 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-lamp"
                  />
                </div>
              </div>

              <div className="glass rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[680px]">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-muted border-b border-white/10">
                        <th className="px-4 py-3 font-medium">Account</th>
                        <th className="px-4 py-3 font-medium">Joined</th>
                        <th className="px-4 py-3 font-medium text-right">Chats</th>
                        <th className="px-4 py-3 font-medium text-right">Questions</th>
                        <th className="px-4 py-3 font-medium">Last active</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {data!.users.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-4 py-6 text-center text-muted text-xs">
                            {query.trim() ? "No users match that search." : "No accounts yet."}
                          </td>
                        </tr>
                      )}
                      {data!.users.map((u) => (
                        <tr
                          key={u.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => openUser(u)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              openUser(u);
                            }
                          }}
                          className="border-b border-white/[0.05] last:border-0 cursor-pointer hover:bg-white/[0.04] focus:outline-none focus-visible:bg-white/[0.06] transition-colors"
                        >
                          <td className="px-4 py-3">
                            <div className="text-ink truncate max-w-[220px]">
                              {u.name || u.email.split("@")[0]}
                            </div>
                            <div className="text-xs text-muted truncate max-w-[220px]">{u.email}</div>
                          </td>
                          <td className="px-4 py-3 text-muted whitespace-nowrap">{formatDate(u.createdAt)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-muted">
                            {NUM.format(u.conversations)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-ink">
                            {NUM.format(u.questions)}
                          </td>
                          <td className="px-4 py-3 text-muted whitespace-nowrap">{timeAgo(u.lastActiveAt)}</td>
                          <td className="px-4 py-3 text-muted">
                            <ChevronRight className="w-4 h-4 ml-auto" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <p className="mt-2 text-xs text-muted">
                Select a user to see the questions they&apos;ve asked.
              </p>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
