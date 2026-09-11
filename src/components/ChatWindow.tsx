"use client";

import { useState, useRef, useEffect } from "react";
import { ArrowUp, LogOut, ChevronDown } from "lucide-react";
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
  chatError,
  onConversationCreated,
}: {
  isAuthed: boolean;
  userEmail?: string;
  onLogout?: () => void;
  conversationId?: string;
  initialMessages?: Msg[];
  chatError?: string | null;
  onConversationCreated?: (id: string) => void;
}) {
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [input, setInput] = useState("");
  // Everyone starts on Flash; guests are locked to it (server-enforced too).
  const [model, setModel] = useState<ModelKey>("flash");
  const [lang, setLang] = useState<Lang>("en");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [convoId, setConvoId] = useState<string | undefined>(conversationId);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevConvoRef = useRef(conversationId);
  const lastSyncedRef = useRef<Msg[]>([]);
  // Set when WE created the conversation mid-send, so the conversationId
  // prop change that follows shouldn't wipe our local streaming state with
  // the parent's (stale, empty) message list.
  const skipNextSyncRef = useRef(false);
  // Stream-painting generation. An in-flight stream may only paint while its
  // captured generation is the current one; a genuine view switch (handled in
  // the sync effect below) bumps the counter, which stops the stale stream
  // from touching the message list. This is race-free because the bump
  // happens exactly where the switch happens — no effect-timing ambiguity.
  const streamGenRef = useRef(0);
  const activeStreamGenRef = useRef<number | null>(null);

  // Keep local state in sync with the parent.
  // conversationId changes when switching convos or creating a new one.
  // initialMessages changes when the parent finishes fetching messages.
  // We only call setMessages when the content actually differs to avoid
  // unnecessary re-renders / scroll jumps on every parent render.
  useEffect(() => {
    setConvoId(conversationId);

    const idChanged = prevConvoRef.current !== conversationId;
    prevConvoRef.current = conversationId;

    // We created this conversation ourselves mid-send — keep the local
    // streaming state instead of clobbering it with the parent's list.
    if (idChanged && skipNextSyncRef.current) {
      skipNextSyncRef.current = false;
      lastSyncedRef.current = initialMessages;
      return;
    }

    if (idChanged) {
      // A genuine view switch — invalidate any in-flight stream so it stops
      // painting into the conversation we're leaving. (Creating our own
      // conversation mid-send takes the skip branch above instead.)
      streamGenRef.current++;
      // Conversation switched — use whatever the parent has (may be [] if
      // the fetch is still in-flight; will update when it completes).
      const next = conversationId !== undefined ? initialMessages : [];
      if (next !== lastSyncedRef.current) {
        lastSyncedRef.current = next;
        setMessages(next);
      }
    } else if (conversationId !== undefined && activeStreamGenRef.current === null) {
      // Same conversation, but initialMessages prop may have updated after
      // the fetch completed. Sync if content differs.
      if (initialMessages !== lastSyncedRef.current) {
        lastSyncedRef.current = initialMessages;
        setMessages(initialMessages);
      }
    }
  }, [conversationId, initialMessages]);

  // Scroll the messages container only — not the whole page.
  // scrollIntoView bubbles to all scrollable ancestors which causes
  // the landing page itself to jump when streaming tokens arrive.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    // Belt-and-braces client guard; the API enforces this for real.
    if (!isAuthed && model !== "flash") {
      setError("Sign in to use models other than Flash.");
      return;
    }
    setError(null);
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setSending(true);
    const gen = ++streamGenRef.current;
    activeStreamGenRef.current = gen;

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
        // We created this conversation ourselves mid-send. Tell the sync
        // effect to skip the next conversationId change so it doesn't wipe
        // the local streaming state with the parent's stale empty list.
        skipNextSyncRef.current = true;
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
          // A view switch bumped the generation mid-stream — stop painting.
          // The reply is saved server-side and will load when the user opens
          // this conversation again.
          if (streamGenRef.current !== gen) return m;
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
      activeStreamGenRef.current = null;
    }
  }

  const displayName = userEmail ? userEmail.split("@")[0] : "";

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex justify-between items-center px-4 py-3 gap-2 border-b border-white/[0.06]">
        <ModelSelector value={model} onChange={setModel} isAuthed={isAuthed} />
        <div className="flex items-center gap-2">
          <LanguageToggle value={lang} onChange={setLang} />
          {isAuthed && userEmail && (
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen((v) => !v)}
                className="flex items-center gap-1 hover:opacity-90 transition-opacity"
              >
                <span className="w-8 h-8 rounded-full bg-lamp/90 text-[#1a1204] flex items-center justify-center text-sm font-semibold">
                  {userEmail[0].toUpperCase()}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-muted" />
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

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center gap-3 px-4">
            <div className="w-14 h-14 rounded-full glass flex items-center justify-center mb-1">
              <img src="/logo.svg" alt="Beacon" className="w-7 h-7" />
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
        {messages.map((m, i) => {
          const isLastAssistant = i === messages.length - 1 && m.role === "assistant";
          const isThinking = sending && isLastAssistant && !m.content;
          if (isThinking) {
            return (
              <div key={i} className="flex items-center gap-3 max-w-[85%]">
                <div className="shrink-0 w-8 h-8 flex items-center justify-center">
                  <img src="/logo.svg" alt="Beacon" className="w-7 h-7" />
                </div>
                <div className="glass rounded-2xl rounded-tl-md px-5 py-3.5 flex items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-lamp thinking-dot" style={{ animationDelay: "0ms" }} />
                    <span className="w-2 h-2 rounded-full bg-lamp thinking-dot" style={{ animationDelay: "200ms" }} />
                    <span className="w-2 h-2 rounded-full bg-lamp thinking-dot" style={{ animationDelay: "400ms" }} />
                  </div>
                </div>
              </div>
            );
          }
          return <MessageBubble key={i} role={m.role} content={m.content} />;
        })}
        {chatError && (
          <div className="text-sm text-amber-300 border border-amber-800/40 bg-amber-950/30 rounded-lg px-3 py-2 max-w-[85%]">
            {chatError}
          </div>
        )}
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
