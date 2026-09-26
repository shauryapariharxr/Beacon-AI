"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  ArrowUp,
  LogOut,
  ChevronDown,
  Menu,
  Paperclip,
  FileText,
  Trash2,
  X,
  Loader2,
} from "lucide-react";
import { MessageBubble } from "./MessageBubble";
import { BotAvatar } from "./BotAvatar";
import { ModelSelector } from "./ModelSelector";
import { ConfirmLogoutDialog } from "./ConfirmLogoutDialog";
import { MODELS, ModelKey } from "@/lib/models";

type Msg = { role: "user" | "assistant"; content: string };
type DocInfo = { id: string; filename: string; chunkCount: number; status: string; error?: string | null };

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
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [convoId, setConvoId] = useState<string | undefined>(conversationId);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  // RAG: documents list, which docs are pinned to this chat, and upload state.
  const [docs, setDocs] = useState<DocInfo[]>([]);
  const [docsOpen, setDocsOpen] = useState(false);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteText, setPasteText] = useState("");
  // Filenames the server actually retrieved for the latest reply (X-Rag-Docs).
  const [ragNote, setRagNote] = useState<string | null>(null);
  // Logging out is one confirm away: a stray tap on the avatar used to end
  // the session instantly.
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  // ---------- RAG: documents ----------
  const loadDocs = useCallback(async () => {
    try {
      const res = await fetch("/api/documents");
      if (!res.ok) return;
      const data = await res.json();
      setDocs(data.documents || []);
    } catch {
      // Non-fatal: documents panel just stays empty.
    }
  }, []);

  useEffect(() => {
    if (isAuthed) loadDocs();
  }, [isAuthed, loadDocs]);

  async function handleUpload(file: File) {
    setUploading(true);
    setDocsError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/documents", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDocsError(data.error || "Upload failed.");
        return;
      }
      if (data.document?.id) {
        // Pin what was just uploaded so the next question targets it.
        setPinnedIds((p) => (p.includes(data.document.id) ? p : [...p, data.document.id]));
      }
      loadDocs();
    } catch {
      setDocsError("Upload failed — check your connection.");
    } finally {
      setUploading(false);
    }
  }

  async function handlePasteSave() {
    if (!pasteTitle.trim() || !pasteText.trim()) return;
    setUploading(true);
    setDocsError(null);
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: pasteTitle.trim(), text: pasteText }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDocsError(data.error || "Save failed.");
        return;
      }
      if (data.document?.id) {
        setPinnedIds((p) => (p.includes(data.document.id) ? p : [...p, data.document.id]));
      }
      setPasteTitle("");
      setPasteText("");
      setPasteOpen(false);
      loadDocs();
    } catch {
      setDocsError("Save failed — check your connection.");
    } finally {
      setUploading(false);
    }
  }

  async function removeDoc(id: string) {
    setDocs((d) => d.filter((x) => x.id !== id));
    setPinnedIds((p) => p.filter((x) => x !== id));
    try {
      await fetch(`/api/documents?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch {
      // List already updated locally; refetch on next open reconciles.
    }
    loadDocs();
  }

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setRagNote(null);
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
        body: JSON.stringify({
          message: text,
          modelKey: model,
          conversationId: convoId,
          // Pinned documents scope retrieval to those files; empty = all docs.
          documentIds: isAuthed && pinnedIds.length ? pinnedIds : undefined,
          // Guests have no server-side history, so carry the last few turns
          // from local state — this is what gives the AI its memory.
          guestHistory: isAuthed
            ? undefined
            : messages
                .filter((m) => m.content)
                .slice(-10)
                .map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Something went wrong");
      }

      // Which documents grounded this reply (server-decided, post-retrieval).
      const ragHeader = res.headers.get("X-Rag-Docs");
      if (ragHeader) {
        try {
          const names: string[] = JSON.parse(ragHeader);
          if (names.length) setRagNote(`Answered using ${names.join(", ")}`);
        } catch {
          // header is cosmetic — ignore malformed values
        }
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

  // Hidden file input lives at the component root level.
  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept=".pdf,.txt,.md,.csv,.json"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) handleUpload(f);
        e.target.value = "";
      }}
    />
  );

  // The tool row is only worth its height when it actually holds something:
  // with the model picker moved into the composer, a signed-out visitor has
  // neither a menu button nor an account menu, and used to get a bare 24px
  // strip with a border and nothing in it.
  const showToolRow = Boolean(onOpenSidebar) || Boolean(isAuthed && userEmail);

  return (
    <div className="flex flex-col h-full">
      {fileInput}
      {showToolRow && (
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
        </div>
        <div className="flex items-center gap-2">
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
                        setConfirmLogout(true);
                      }}
                      className="w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg text-sm text-ink hover:bg-white/[0.06] transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      Log out
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      )}

      <div className="relative flex-1 min-h-0">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto px-4 py-6 space-y-4"
        >
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center gap-3 px-4">
            <BotAvatar size={56} className="mb-1" />
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
                  Your free AI study buddy
                </div>
                <div className="glass rounded-xl px-4 py-3 text-sm text-muted max-w-sm mt-1">
                  Chatting as guest. Sign up to save your conversations.
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
              <div key={i} className="flex items-center gap-2.5 max-w-[85%] animate-msg-in">
                <BotAvatar />
                <div className="rounded-2xl rounded-tl-md border border-white/[0.10] bg-white/[0.02] px-5 py-3.5 flex items-center gap-2">
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
          {/* Documents drawer — uploads, paste-notes, pin-to-chat */}
          {isAuthed && docsOpen && (
            <div className="glass-strong rounded-2xl p-3 mb-2 animate-pop-in">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium text-ink">Knowledge documents</div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="text-xs bg-white/[0.08] hover:bg-white/[0.14] rounded-lg px-2.5 py-1.5 text-ink transition-colors disabled:opacity-50"
                  >
                    Upload file
                  </button>
                  <button
                    onClick={() => setPasteOpen(true)}
                    disabled={uploading}
                    className="text-xs bg-white/[0.08] hover:bg-white/[0.14] rounded-lg px-2.5 py-1.5 text-ink transition-colors disabled:opacity-50"
                  >
                    Paste notes
                  </button>
                  <button
                    onClick={() => setDocsOpen(false)}
                    className="p-1.5 text-muted hover:text-ink rounded-lg hover:bg-white/[0.06] transition-colors"
                    aria-label="Close documents"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              {uploading && (
                <div className="flex items-center gap-2 text-xs text-muted py-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Reading and indexing…
                </div>
              )}
              {docsError && (
                <div className="text-xs text-red-300 bg-red-950/40 border border-red-900/60 rounded-lg px-2.5 py-1.5 mb-2">
                  {docsError}
                </div>
              )}
              {pasteOpen && (
                <div className="mb-2 space-y-2">
                  <input
                    value={pasteTitle}
                    onChange={(e) => setPasteTitle(e.target.value)}
                    placeholder="Title (e.g. Chapter 4 — Recursion)"
                    className="w-full bg-white/[0.06] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-lamp/60 placeholder:text-muted"
                  />
                  <textarea
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder="Paste your notes here…"
                    rows={5}
                    className="w-full bg-white/[0.06] rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-lamp/60 placeholder:text-muted"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setPasteOpen(false)}
                      className="text-xs px-3 py-1.5 rounded-lg text-muted hover:text-ink hover:bg-white/[0.06] transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handlePasteSave}
                      disabled={uploading || !pasteTitle.trim() || !pasteText.trim()}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gradient-to-r from-lamp to-orange-500 text-[#1a1204] disabled:opacity-40"
                    >
                      Save notes
                    </button>
                  </div>
                </div>
              )}
              <div className="space-y-1 max-h-56 overflow-y-auto">
                {docs.length === 0 && !uploading && (
                  <p className="text-xs text-muted px-1 py-2">
                    Upload a PDF or paste notes — Beacon will answer questions using them
                    (with citations) and remember relevant points across chats.
                  </p>
                )}
                {docs.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-white/[0.04] text-sm"
                  >
                    <FileText className="w-3.5 h-3.5 shrink-0 text-lamp" />
                    <span className="flex-1 truncate" title={d.filename}>{d.filename}</span>
                    <span className="text-[11px] text-muted shrink-0">
                      {d.status === "error" ? "failed" : `${d.chunkCount} parts`}
                    </span>
                    <button
                      onClick={() =>
                        setPinnedIds((p) =>
                          p.includes(d.id) ? p.filter((x) => x !== d.id) : [...p, d.id]
                        )
                      }
                      className={`text-[11px] px-2 py-0.5 rounded-full transition-colors shrink-0 ${
                        pinnedIds.includes(d.id)
                          ? "bg-lamp/90 text-[#1a1204] font-semibold"
                          : "bg-white/[0.08] text-muted hover:text-ink"
                      }`}
                      title={pinnedIds.includes(d.id) ? "Pinned to this chat" : "Pin to this chat"}
                    >
                      {pinnedIds.includes(d.id) ? "Pinned" : "Pin"}
                    </button>
                    <button
                      onClick={() => removeDoc(d.id)}
                      className="p-1 -m-0.5 text-muted hover:text-red-400 transition-colors shrink-0"
                      aria-label="Delete document"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Composer: the text field owns the row, and the controls sit under
              it — model on the left, send on the right — so the box reads as
              one input rather than a toolbar with a textarea in it. */}
          <div className="glass-strong rounded-2xl p-2.5">
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
              placeholder="Ask anything..."
              rows={1}
              className="w-full resize-none bg-transparent px-2.5 pt-2 pb-1 text-[15px] focus:outline-none placeholder:text-muted"
            />
            <div className="flex items-center justify-between gap-2 mt-0.5">
              <div className="flex items-center gap-1 min-w-0">
                <ModelSelector value={model} onChange={setModel} isAuthed={isAuthed} dropUp />
                {isAuthed && (
                  <button
                    onClick={() => setDocsOpen((v) => !v)}
                    disabled={uploading}
                    aria-label="Attach documents"
                    title="Documents — upload PDFs or notes Beacon answers from"
                    className={`w-9 h-9 rounded-full flex items-center justify-center transition-all shrink-0 relative ${
                      docsOpen || pinnedIds.length
                        ? "bg-lamp/20 text-lamp"
                        : "text-muted hover:text-ink hover:bg-white/[0.06]"
                    }`}
                  >
                    <Paperclip className="w-4.5 h-4.5" />
                    {pinnedIds.length > 0 && (
                      <span className="absolute translate-x-3 -translate-y-3 w-4 h-4 rounded-full bg-lamp text-[#1a1204] text-[10px] font-bold flex items-center justify-center">
                        {pinnedIds.length}
                      </span>
                    )}
                  </button>
                )}
              </div>
              <button
                onClick={send}
                disabled={sending || !input.trim()}
                aria-label="Send"
                className="w-9 h-9 rounded-full bg-gradient-to-br from-lamp to-orange-500 text-[#1a1204] flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-105 transition-all shrink-0 relative"
              >
                <ArrowUp className="w-4 h-4" strokeWidth={2.5} />
              </button>
            </div>
          </div>
          <div className="text-xs text-muted mt-2 px-1 flex items-center gap-2 flex-wrap">
            <span>
              Using <span className="text-lamp">{MODELS[model].label}</span>
            </span>
            {ragNote && (
              <span className="text-lamp/90">· {ragNote}</span>
            )}
          </div>
        </div>
      </div>

      {isAuthed && (
        <ConfirmLogoutDialog
          open={confirmLogout}
          busy={loggingOut}
          onCancel={() => setConfirmLogout(false)}
          onConfirm={async () => {
            setLoggingOut(true);
            try {
              await onLogout?.();
            } finally {
              setLoggingOut(false);
              setConfirmLogout(false);
            }
          }}
        />
      )}
    </div>
  );
}
