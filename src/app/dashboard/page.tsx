"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { ChatWindow } from "@/components/ChatWindow";

type Conversation = { id: string; title: string; createdAt: number };
type Msg = { role: "user" | "assistant"; content: string };

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
      const data = await res.json();
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
    const res = await fetch("/api/conversations");
    const data = await res.json();
    setConversations(data.conversations || []);
  }

  async function selectConversation(id: string) {
    setActiveId(id);
    const res = await fetch(`/api/conversations/${id}`);
    const data = await res.json();
    setMessages(
      (data.messages || []).map((m: any) => ({ role: m.role, content: m.content }))
    );
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
        userEmail={userEmail}
        onLogout={logout}
      />
      <div className="flex-1 min-w-0">
        <ChatWindow
          isAuthed
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
