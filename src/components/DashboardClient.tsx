"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { ChatWindow } from "@/components/ChatWindow";
import { BeaconLoader } from "@/components/BeaconLoader";
import { ConfirmLogoutDialog } from "@/components/ConfirmLogoutDialog";
import { useBackLogoutGuard } from "@/lib/useBackLogoutGuard";
import { hardLogout } from "@/lib/hardLogout";

type Conversation = { id: string; title: string; createdAt: number };
type Msg = { role: "user" | "assistant"; content: string };

// Parses a fetch Response as JSON without throwing — a 500 with an empty
// body (e.g. a route that crashed on the server) would otherwise blow up
// with "Unexpected end of JSON input" and take the whole page down.
async function safeJson(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

// /dashboard/page.tsx (a server component) has already verified the session
// before this renders — so the user identity is fetched here, not checked.
export function DashboardClient() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | undefined>();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [chatError, setChatError] = useState<string | null>(null);
  const selectIdRef = useRef<string>();

  // Browser Back on the dashboard asks before ending the session.
  const { confirming: backConfirming, settle: settleBackGuard } = useBackLogoutGuard();

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/auth/me");
      const data = await safeJson(res);
      if (!data.user) {
        // Session vanished server-side mid-tab (expired, revoked): the server
        // gate missed it only because this render came from the client cache.
        router.replace("/login");
        return;
      }
      setUserEmail(data.user.email);
      setUserName(data.user.name || "");
      setChecking(false);
      loadConversations();
    })();
  }, []);

  // Back/forward cache: a restored page never re-runs effects or hits the
  // server, so a logged-out tab restored via Back/Forward would still show
  // the signed-in UI. Re-check the session on every restore.
  useEffect(() => {
    const recheck = () => {
      fetch("/api/auth/me")
        .then((r) => r.json())
        .then((d) => {
          if (!d?.user) router.replace("/login");
        })
        .catch(() => {});
    };
    window.addEventListener("pageshow", recheck);
    return () => window.removeEventListener("pageshow", recheck);
  }, [router]);

  async function loadConversations() {
    try {
      const res = await fetch("/api/conversations");
      const data = await safeJson(res);
      setConversations(data.conversations || []);
    } catch {
      setConversations([]);
    }
  }

  async function selectConversation(id: string) {
    setActiveId(id);
    selectIdRef.current = id;
    setMessages([]);
    setChatError(null);
    try {
      const res = await fetch(`/api/conversations/${id}`);
      // If the user clicked a different conversation while this fetch was
      // in flight, discard the stale response so it doesn't overwrite.
      if (selectIdRef.current !== id) return;
      if (!res.ok) {
        const data = await safeJson(res);
        console.error("Failed to load conversation:", res.status, data);
        if (selectIdRef.current === id) {
          setChatError(data.error || "Failed to load conversation");
        }
        return;
      }
      const data = await safeJson(res);
      if (selectIdRef.current !== id) return;
      setMessages(
        (data.messages || []).map((m: any) => ({ role: m.role, content: m.content }))
      );
    } catch (err) {
      console.error("selectConversation failed:", err);
      if (selectIdRef.current === id) {
        setChatError("Failed to load conversation. Check your connection and try again.");
      }
    }
  }

  async function deleteConversation(id: string) {
    try {
      await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    } catch {
      // Even if the request failed, still refresh the list to stay in sync.
    }
    if (id === activeId || selectIdRef.current === id) {
      setActiveId(undefined);
      selectIdRef.current = undefined;
      setMessages([]);
      setChatError(null);
    }
    loadConversations();
  }

  function newChat() {
    setActiveId(undefined);
    selectIdRef.current = undefined;
    setMessages([]);
    setChatError(null);
  }

  async function logout() {
    // Hard navigation (see hardLogout): drops this signed-in page from the
    // history stack and the back/forward cache, so neither Back nor Forward
    // can re-enter the dashboard after the session ends.
    await hardLogout("/api/auth/logout", "/");
  }

  if (checking) {
    return (
      <div className="h-dvh flex items-center justify-center">
        <BeaconLoader size={72} label="Setting up your dashboard…" />
      </div>
    );
  }

  return (
    <div className="flex h-dvh">
      {/* Browser Back pressed on the dashboard — ask before logging out. */}
      <ConfirmLogoutDialog
        open={backConfirming}
        onCancel={() => settleBackGuard(false)}
        onConfirm={() => void logout()}
      />
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={selectConversation}
        onNewChat={newChat}
        onDelete={deleteConversation}
        userEmail={userEmail}
        userName={userName}
        mobileOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onNavigate={() => setSidebarOpen(false)}
      />
      <div className="flex-1 min-w-0 h-full overflow-hidden">
        <ChatWindow
          isAuthed
          userEmail={userEmail}
          userName={userName}
          onLogout={logout}
          onOpenSidebar={() => setSidebarOpen(true)}
          conversationId={activeId}
          initialMessages={messages}
          chatError={chatError}
          onConversationCreated={(id) => {
            setActiveId(id);
            setChatError(null);
            loadConversations();
          }}
        />
      </div>
    </div>
  );
}
