"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { ChatWindow } from "@/components/ChatWindow";

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

export default function DashboardPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [userEmail, setUserEmail] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | undefined>();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [chatError, setChatError] = useState<string | null>(null);
  const selectIdRef = useRef<string>();

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/auth/me");
      const data = await safeJson(res);
      if (!data.user) {
        router.push("/login");
        return;
      }
      setUserEmail(data.user.email);
      setChecking(false);
      loadConversations();
    })();
  }, []);

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
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
  }

  if (checking) {
    return <div className="h-screen flex items-center justify-center text-muted">Loading…</div>;
  }

  return (
    <div className="flex h-screen">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={selectConversation}
        onNewChat={newChat}
        onDelete={deleteConversation}
        userEmail={userEmail}
      />
      <div className="flex-1 min-w-0 h-full overflow-hidden">
        <ChatWindow
          isAuthed
          userEmail={userEmail}
          onLogout={logout}
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
