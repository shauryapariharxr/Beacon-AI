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
      <div className="shrink-0 flex justify-end gap-2 px-4 pt-3">
        <ModelSelector value={model} onChange={setModel} />
        <LanguageToggle value={lang} onChange={setLang} />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center gap-4 px-4">
            <div className="font-serif text-3xl md:text-4xl text-ink max-w-lg">
              {t(lang, "tagline")}
            </div>
            {!isAuthed && (
              <div className="glass rounded-xl px-4 py-3 text-sm text-muted max-w-sm">
                {t(lang, "guestNotice")}
              </div>
            )}
          </div>
        )}
        {messages.map((m, i) => (
          <MessageBubble key={i} role={m.role} content={m.content || "…"} />
        ))}
        {error && (
          <div className="text-sm text-red-300 border border-red-900/60 bg-red-950/40 rounded-lg px-3 py-2 max-w-[75%]">
            {error}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 p-3 md:p-4">
        <div className="glass-strong rounded-2xl p-2 flex gap-2 items-end max-w-4xl mx-auto w-full">
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
            className="flex-1 resize-none bg-transparent px-3 py-2.5 text-[15px] focus:outline-none placeholder:text-muted"
          />
          <button
            onClick={send}
            disabled={sending || !input.trim()}
            className="bg-lamp text-[#1a1204] font-medium rounded-xl px-4 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-lamp/90 transition-colors shrink-0"
          >
            {t(lang, "send")}
          </button>
        </div>
      </div>
    </div>
  );
}
