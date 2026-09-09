"use client";

import { useState, useRef, useEffect } from "react";
import { Bot, ArrowUp, LogOut } from "lucide-react";
import { MessageBubble } from "./MessageBubble";
import { ModelSelector } from "./ModelSelector";
import { LanguageToggle } from "./LanguageToggle";
import { MODELS, ModelKey } from "@/lib/models";
import { Lang, t } from "@/lib/i18n";

type Msg = { role: "user" | "assistant"; content: string };

export function ChatWindow({
  isAuthed,
  userEmail,
  onLogout,
  conversationId,
  initialMessages = [],
  onConversationCreated,
}: {
  isAuthed: boolean;
  userEmail?: string;
  onLogout?: () => void;
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
  const [userMenuOpen, setUserMenuOpen] = useState(false);
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

  const displayName = userEmail ? userEmail.split("@")[0] : "";

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex justify-between items-center px-4 pt-3 gap-2">
        <ModelSelector value={model} onChange={setModel} />
        <div className="flex items-center gap-2">
          <LanguageToggle value={lang} onChange={setLang} />
          {isAuthed && userEmail && (
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen((v) => !v)}
                className="w-8 h-8 rounded-full bg-lamp/90 text-[#1a1204] flex items-center justify-center text-sm font-semibold hover:brightness-105 transition-all"
              >
                {userEmail[0].toUpperCase()}
              </button>
              {userMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-2 w-44 glass-strong rounded-xl p-1.5 z-50">
                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        onLogout?.();
                      }}
                      className="w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg text-sm text-ink hover:bg-white/[0.06] transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      {t(lang, "logout")}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center gap-3 px-4">
            <div className="w-14 h-14 rounded-full glass flex items-center justify-center mb-1">
              <Bot className="w-6 h-6 text-lamp" />
            </div>
            {isAuthed && displayName ? (
              <>
                <div className="font-serif font-bold text-2xl md:text-3xl text-ink capitalize">
                  Welcome back, {displayName}
                </div>
                <p className="text-muted text-sm">Pick a model and start a new conversation.</p>
              </>
            ) : (
              <>
                <div className="font-serif font-bold text-3xl md:text-4xl text-ink max-w-lg">
                  {t(lang, "tagline")}
                </div>
                <div className="glass rounded-xl px-4 py-3 text-sm text-muted max-w-sm mt-1">
                  {t(lang, "guestNotice")}
                </div>
              </>
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
        <div className="max-w-4xl mx-auto w-full">
          <div className="glass-strong rounded-2xl p-2 flex gap-2 items-end">
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
              aria-label={t(lang, "send")}
              className="w-10 h-10 rounded-xl bg-gradient-to-br from-lamp to-orange-500 text-[#1a1204] flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-105 transition-all shrink-0"
            >
              <ArrowUp className="w-4 h-4" strokeWidth={2.5} />
            </button>
          </div>
          <div className="text-xs text-muted mt-2 px-1">
            Using <span className="text-lamp">{MODELS[model].label}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
