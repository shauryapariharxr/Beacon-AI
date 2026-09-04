"use client";

import { useState, useRef, useEffect } from "react";
import { MessageBubble } from "./MessageBubble";
import { ModelSelector } from "./ModelSelector";
import { LanguageToggle } from "./LanguageToggle";
import { ModelKey } from "@/lib/models";
import { Lang, t } from "@/lib/i18n";

type Msg = { role: "user" | "assistant"; content: string };

export function ChatWindow({
  isAuthed,
  conversationId,
  initialMessages = [],
  onConversationCreated,
}: {
  isAuthed: boolean;
  conversationId?: string;
  initialMessages?: Msg[];
  onConversationCreated?: (id: string) => void;
}) {
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [input, setInput] = useState("");
  const [model, setModel] = useState<ModelKey>("flash");
  const [lang, setLang] = useState<Lang>("en");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [convoId, setConvoId] = useState<string | undefined>(conversationId);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages(initialMessages);
    setConvoId(conversationId);
  }, [conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setError(null);
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setSending(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, modelKey: model, conversationId: convoId }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Something went wrong");
      }

      const newConvoId = res.headers.get("X-Conversation-Id");
      if (newConvoId && !convoId) {
        setConvoId(newConvoId);
        onConversationCreated?.(newConvoId);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: acc };
          return copy;
        });
      }
    } catch (e: any) {
      setError(e.message || "Failed to send message");
      setMessages((m) => m.slice(0, -1));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="font-serif text-lg">{t(lang, "appName")}</div>
        <div className="flex gap-2">
          <ModelSelector value={model} onChange={setModel} />
          <LanguageToggle value={lang} onChange={setLang} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center text-muted gap-2">
            <div className="font-serif text-2xl text-ink">{t(lang, "tagline")}</div>
            {!isAuthed && <div className="text-sm max-w-sm">{t(lang, "guestNotice")}</div>}
          </div>
        )}
        {messages.map((m, i) => (
          <MessageBubble key={i} role={m.role} content={m.content || "…"} />
        ))}
        {error && (
          <div className="text-sm text-red-400 border border-red-900 bg-red-950/40 rounded-lg px-3 py-2 max-w-[75%]">
            {error}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-border p-4">
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={t(lang, "placeholder")}
            rows={1}
            className="flex-1 resize-none bg-panel2 border border-border rounded-xl px-4 py-2.5 text-[15px] focus:outline-none focus:ring-1 focus:ring-lamp"
          />
          <button
            onClick={send}
            disabled={sending || !input.trim()}
            className="bg-lamp text-[#1a1204] font-medium rounded-xl px-4 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-lamp/90 transition-colors"
          >
            {t(lang, "send")}
          </button>
        </div>
      </div>
    </div>
  );
}
