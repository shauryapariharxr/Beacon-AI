"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ArrowUp, LogOut, ChevronDown, Menu } from "lucide-react";
import { MessageBubble } from "./MessageBubble";
import { ModelSelector } from "./ModelSelector";
import { LanguageToggle } from "./LanguageToggle";
import { MODELS, ModelKey } from "@/lib/models";
import { Lang, t } from "@/lib/i18n";

type Msg = { role: "user" | "assistant"; content: string };

export function ChatWindow({
  isAuthed,
  userEmail,
  userName,
  onLogout,
  conversationId,
  initialMessages = [],
  chatError,
  onConversationCreated,
  onOpenSidebar,
}: {
  isAuthed: boolean;
  userEmail?: string;
  userName?: string;
  onLogout?: () => void;
  onOpenSidebar?: () => void;
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Track whether the user has scrolled away from the bottom while the AI
  // streams. If they scroll up to read, we stop yanking them down on every
  // token — a small “jump to latest” pill appears instead.
  const isPinnedRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  // Coalesce streaming re-renders: the reader loop fires many times per
  // second; painting at most once per animation frame keeps mobile GPUs
  // happy and scrolling smooth without any perceptible latency.
  const paintRafRef = useRef<number | null>(null);
  const accRef = useRef("");
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
  // Smart auto-scroll: follow the stream only while the user is at (or
  // near) the bottom; otherwise leave them where they are.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (isPinnedRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
    setShowJump(!isPinnedRef.current);
  }, [messages]);

  // Near-bottom = within 80px. Also re-pin if the user lands back at the
  // bottom, so streaming follows them again.
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    const pinned = gap < 80;
    if (pinned !== isPinnedRef.current) {
      isPinnedRef.current = pinned;
      setShowJump(!pinned);
    }
  }, []);

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
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    // We're sending — definitely want to watch the reply stream in.
    isPinnedRef.current = true;
    setShowJump(false);
    setMessages((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setSending(true);
    const gen = ++streamGenRef.current;
    activeStreamGenRef.current = gen;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, modelKey: model, lang, conversationId: convoId }),
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
      accRef.current = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        accRef.current = acc;
        // Paint at most once per animation frame while streaming. The raw
        // reader loop can fire dozens of times per second on fast models;
        // coalescing to one setState per frame keeps mobile GPUs (and
        // low-end Androids especially) smooth with zero perceptible delay.
        if (paintRafRef.current === null) {
          paintRafRef.current = requestAnimationFrame(() => {
            paintRafRef.current = null;
            const text = accRef.current;
            setMessages((m) => {
              // A view switch bumped the generation mid-stream — stop painting.
              // The reply is saved server-side and will load when the user opens
              // this conversation again.
              if (streamGenRef.current !== gen) return m;
              const copy = [...m];
              copy[copy.length - 1] = { role: "assistant", content: text };
              return copy;
            });
          });
        }
      }
    } catch (e: any) {
      setError(e.message || "Failed to send message");
      setMessages((m) => m.slice(0, -1));
    } finally {
      setSending(false);
      activeStreamGenRef.current = null;
      // Flush any token that arrived between the last read and now.
      if (paintRafRef.current !== null) {
        cancelAnimationFrame(paintRafRef.current);
        paintRafRef.current = null;
        const finalText = accRef.current;
        setMessages((m) => {
          if (streamGenRef.current !== gen) return m;
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: finalText };
          return copy;
        });
      }
    }
  }

  const displayName =
    (userName && userName.trim()) ||
    (userEmail ? userEmail.split("@")[0] : "");

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex justify-between items-center px-4 py-3 gap-2 border-b border-white/[0.06]">
        <div className="flex items-center gap-2 min-w-0">
          {onOpenSidebar && (
            <button
              onClick={onOpenSidebar}
              className="md:hidden p-2 -ml-1.5 rounded-lg text-muted hover:text-ink hover:bg-white/[0.06] transition-colors"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}
          <ModelSelector value={model} onChange={setModel} isAuthed={isAuthed} />
        </div>
        <div className="flex items-center gap-2">
          <LanguageToggle value={lang} onChange={setLang} />
          {isAuthed && userEmail && (
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen((v) => !v)}
                className="flex items-center gap-1 hover:opacity-90 transition-opacity"
              >
                <span className="w-8 h-8 rounded-full bg-lamp/90 text-[#1a1204] flex items-center justify-center text-sm font-semibold">
                  {(displayName || "?")[0].toUpperCase()}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-muted" />
              </button>
              {userMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-2 w-44 glass-strong rounded-xl p-1.5 z-50 animate-pop-in">
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

      <div className="relative flex-1 min-h-0">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto px-4 py-6 space-y-4"
        >
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
              <div key={i} className="flex items-center gap-3 max-w-[85%] animate-msg-in">
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
          <div className="text-sm text-amber-300 border border-amber-800/40 bg-amber-950/30 rounded-lg px-3 py-2 max-w-[85%] animate-toast-in">
            {chatError}
          </div>
        )}
        {error && (
          <div className="text-sm text-red-300 border border-red-900/60 bg-red-950/40 rounded-lg px-3 py-2 max-w-[75%] animate-toast-in">
            {error}
          </div>
        )}
        <div ref={bottomRef} />
        </div>
        {showJump && (
          <button
            onClick={() => {
              const el = scrollRef.current;
              if (!el) return;
              isPinnedRef.current = true;
              setShowJump(false);
              el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
            }}
            aria-label="Jump to latest"
            className="absolute bottom-3 right-4 z-10 glass-strong rounded-full px-3 py-1.5 text-xs text-ink shadow-lg animate-pop-in"
          >
            ↓ Latest
          </button>
        )}
      </div>

      <div className="shrink-0 p-3 md:p-4 pb-safe">
        <div className="max-w-4xl mx-auto w-full">
          <div className="glass-strong rounded-2xl p-2 flex gap-2 items-end">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                // Auto-grow up to ~5 rows, then scroll internally.
                const el = e.target;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
              }}
              onKeyDown={(e) => {
                // Phones: Enter makes a newline (no hardware keyboard, and
                // mobile virtual keyboards make accidental sends common).
                // Desktop: Enter sends, Shift+Enter newlines.
                const isMobile =
                  typeof window !== "undefined" &&
                  window.matchMedia("(pointer: coarse)").matches;
                if (e.key === "Enter" && !e.shiftKey && !isMobile) {
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
