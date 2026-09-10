"use client";

import { useEffect, useState } from "react";
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
    try {
      const res = await fetch(`/api/conversations/${id}`);
      const data = await safeJson(res);
      setMessages(
        (data.messages || []).map((m: any) => ({ role: m.role, content: m.content }))
      );
    } catch {
      setMessages([]);
    }
  }

  async function deleteConversation(id: string) {
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    if (id === activeId) {
      setActiveId(undefined);
      setMessages([]);
    }
    loadConversations();
  }

  function newChat() {
    setActiveId(undefined);
    setMessages([]);
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
          onConversationCreated={(id) => {
            setActiveId(id);
            loadConversations();
          }}
        />
      </div>
    </div>
  );
}
