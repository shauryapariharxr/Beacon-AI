"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  ArrowUp,
  FileText,
  LogOut,
  Menu,
  Paperclip,
  Trash2,
  X,
  Loader2,
  Plus,
  Zap,
  ClipboardPaste,
} from "lucide-react";
import { MessageBubble } from "./MessageBubble";
import { DocumentGeneratingBubble } from "./DocumentGeneratingBubble";
import { BotAvatar } from "./BotAvatar";
import { Avatar } from "./Avatar";
import { ModelSelector } from "./ModelSelector";
import { ConfirmLogoutDialog } from "./ConfirmLogoutDialog";
import { MODELS, ModelKey } from "@/lib/models";

type Msg = { role: "user" | "assistant"; content: string };
type DocInfo = { id: string; filename: string; chunkCount: number; status: string; error?: string | null };


export function ChatWindow({
  isAuthed,
  userEmail,
  userName,
  avatarUrl,
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
  avatarUrl?: string | null;
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
  // The model chip owns its own menu, but the empty-state shortcut needs to
  // open it too, so the open flag lives here.
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  // RAG: documents list, which docs are pinned to this chat, and upload state.
  const [docs, setDocs] = useState<DocInfo[]>([]);
  const [docsOpen, setDocsOpen] = useState(false);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteText, setPasteText] = useState("");
  // The tools menu only holds knowledge documents now: the format (PDF, Word,
  // slides) is detected from the message on the server, so there is nothing to
  // pick up front.
  const [docPickerOpen, setDocPickerOpen] = useState(false);
  // What the empty trailing assistant bubble is waiting on: a text stream
  // (dots) or a document generation (paper + dots placeholder).
  const [pendingKind, setPendingKind] = useState<"chat" | "doc">("chat");
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

/**
 * Client mirror of src/lib/documents.ts's isDocumentRequest, so the composer
 * can switch the placeholder to the document animation without waiting for
 * the server. A miss here only picks the wrong idle animation briefly. Keep
 * in sync by hand with the server-side regexes.
 */
function looksLikeDocumentRequest(text: string): boolean {
  if (!text || text.length > 500) return false;
  const probe = text.trim();
  const CREATION =
    /\b(create|creates?|creating|generate|generates?|generating|make|makes?|making|write|writes?|writing|draft|drafts?|prepare|prepares?|produce|build|design|compose|bana|banao|banado|banade|likh|likho|likhdo|dedo)\b/i;
  const DOC_NOUN =
    /\b(pdfs?|word|docx?|document|documents|docs|report|reports|essay|essays|letter|letters|resume|cvs?|presentation|presentations|slides?|powerpoint|ppts?|pptx|assignment|assignments|proposal|proposals|agenda|minutes|summary|summaries|whitepaper|brochure|newsletter|assignment|cover\s*letter|note|notes|guide|paper)\b/i;
  if (
    /^(how|why|when|where|who|is|are|can|could|should|does|do|did|explain|define|differen\w+)/i.test(probe) &&
    !CREATION.test(probe)
  ) {
    return false;
  }
  return CREATION.test(probe) && DOC_NOUN.test(probe);
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
    setMessages((m) => [
      ...m,
      { role: "user", content: text },
      { role: "assistant", content: "" },
    ]);
    // Chosen before the fetch so the empty assistant bubble shows the right
    // placeholder immediately. A picked non-auto format forces a document
    // regardless of wording, like the server does.
    setPendingKind(looksLikeDocumentRequest(text) ? "doc" : "chat");
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
          // Set only when the format picker chose one — the server then treats
          // this turn as a document no matter how it's worded.
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

  // Mobile chrome floats over the conversation instead of taking a strip of
  // height: a round menu disc on the left, the profile photo on the right
  // (replacing the old text bar + chevron). Desktop gets both from the
  // sidebar, so this whole layer is hidden at md and up.
  const showMobileHeader = Boolean(onOpenSidebar) || Boolean(isAuthed && userEmail);

  // Empty-state shortcuts: the tools that otherwise hide behind the "+" menu
  // or the model chip, surfaced as one-tap commands instead of sample prompts.
  const commandRows = [
    ...(isAuthed
      ? [
          {
            icon: Paperclip,
            label: "Attach a PDF to this chat",
            run: () => {
              setDocsOpen(true);
              fileInputRef.current?.click();
            },
          },
          {
            icon: ClipboardPaste,
            label: "Paste notes as context",
            run: () => {
              setDocsOpen(true);
              setPasteOpen(true);
            },
          },
        ]
      : []),
    {
      icon: Zap,
      label: "Switch model",
      run: () => setModelMenuOpen(true),
    },
  ];

  return (
    <div className="relative flex flex-col h-full">
      {fileInput}
      {showMobileHeader && (
        <div className="md:hidden absolute inset-x-0 top-0 z-30 flex items-center justify-between px-3 pt-safe pb-2 pointer-events-none">
          {onOpenSidebar ? (
            <button
              onClick={onOpenSidebar}
              aria-label="Open menu"
              className="pointer-events-auto w-10 h-10 rounded-full bg-[#2f2f2f]/90 backdrop-blur flex items-center justify-center text-ink shadow-lg shadow-black/30 hover:bg-[#3a3a3a] active:scale-95 transition-all"
            >
              <Menu className="w-5 h-5" />
            </button>
          ) : (
            <span />
          )}
          {isAuthed && userEmail && (
            <div className="relative pointer-events-auto">
              <button
                onClick={() => setUserMenuOpen((v) => !v)}
                aria-label="Account menu"
                aria-expanded={userMenuOpen}
                className="w-10 h-10 rounded-full bg-[#2f2f2f]/90 backdrop-blur flex items-center justify-center shadow-lg shadow-black/30 hover:bg-[#3a3a3a] active:scale-95 transition-all ring-1 ring-white/10"
              >
                <Avatar url={avatarUrl} name={displayName} size={32} />
              </button>
              {userMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-2 w-56 glass-strong rounded-xl p-1.5 z-50 animate-pop-in">
                    <div className="px-3 py-2 min-w-0">
                      <div className="text-sm text-ink truncate capitalize">{displayName}</div>
                      <div className="text-[11px] text-muted truncate">{userEmail}</div>
                    </div>
                    <div className="my-1 h-px bg-white/[0.07]" />
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
      )}

      <div className="relative flex-1 min-h-0">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto px-4 pt-20 pb-6 md:pt-6 md:px-6 space-y-4"
        >
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center px-4 pb-16">
            <BotAvatar size={44} className="mb-4 opacity-90" />
            <h1 className="font-serif font-semibold text-[26px] md:text-[32px] text-ink leading-tight max-w-xl">
              {isAuthed && displayName
                ? `What should we work on, ${displayName}?`
                : "What can I help you with?"}
            </h1>
            <p className="text-muted text-sm mt-2 max-w-sm">
              {isAuthed
                ? "Ask anything, or start from a suggestion below."
                : "Chatting as guest — sign up to keep your conversations."}
            </p>
          </div>
        )}
        {messages.map((m, i) => {
          const isLastAssistant = i === messages.length - 1 && m.role === "assistant";
          const isThinking = sending && isLastAssistant && !m.content;
          if (isThinking) {
            if (pendingKind === "doc") {
              return <DocumentGeneratingBubble key={i} />;
            }
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
        <div className="max-w-3xl mx-auto w-full">
          {messages.length === 0 && !conversationId && commandRows.length > 0 && (
            <div className="mb-3">
              {commandRows.map(({ icon: Icon, label, run }) => (
                <button
                  key={label}
                  onClick={run}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left text-[15px] text-ink/90 hover:bg-white/[0.05] transition-colors"
                >
                  <Icon className="w-5 h-5 shrink-0 text-muted" strokeWidth={1.8} />
                  <span className="truncate">{label}</span>
                </button>
              ))}
            </div>
          )}
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
          {/* Composer: one rounded pill instead of a card with a toolbar
              underneath. The + holds the creation tools (document formats and
              knowledge uploads); the send disc is the only accented control. */}
          <div className="flex items-end gap-1.5 rounded-[28px] border border-white/[0.10] bg-[#1c1c1d] px-2 py-2 shadow-[0_10px_30px_rgba(0,0,0,0.35)] focus-within:border-white/[0.22] transition-colors">
            {isAuthed && (
            <div className="relative shrink-0 self-center">
              <button
                onClick={() => setDocPickerOpen((v) => !v)}
                aria-label="Add files and tools"
                aria-expanded={docPickerOpen}
                className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                  docPickerOpen
                    ? "bg-white/[0.10] text-ink"
                    : "text-muted hover:text-ink hover:bg-white/[0.06]"
                }`}
              >
                <Plus className={`w-5 h-5 transition-transform ${docPickerOpen ? "rotate-45" : ""}`} />
              </button>
              {docPickerOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setDocPickerOpen(false)} />
                  <div className="absolute bottom-full mb-3 left-0 w-64 glass-strong rounded-2xl p-2 z-50 animate-pop-in">
                    <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
                      Knowledge
                    </p>
                    <button
                      onClick={() => {
                        setDocPickerOpen(false);
                        setDocsOpen(true);
                      }}
                      className="w-full flex items-center gap-2 px-1.5 py-2 rounded-lg text-sm text-ink hover:bg-white/[0.06] transition-colors"
                    >
                      <FileText className="w-4 h-4 shrink-0 opacity-70" />
                      <span className="flex-1 text-left">Your documents</span>
                      <span className="text-[11px] text-muted">
                        {pinnedIds.length > 0 ? `${pinnedIds.length} pinned` : "Upload, paste"}
                      </span>
                    </button>
                  </div>
                </>
              )}
            </div>
            )}

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
              placeholder="Ask anything…"
              rows={1}
              className="flex-1 min-w-0 self-center resize-none bg-transparent px-1 py-2 max-h-[140px] text-[15px] leading-relaxed focus:outline-none placeholder:text-muted"
            />

            <div className="shrink-0 self-center">
              <ModelSelector
                value={model}
                onChange={setModel}
                isAuthed={isAuthed}
                dropUp
                open={modelMenuOpen}
                onOpenChange={setModelMenuOpen}
              />
            </div>

            <button
              onClick={send}
              disabled={sending || !input.trim()}
              aria-label="Send"
              className="w-9 h-9 shrink-0 self-center rounded-full bg-lamp text-[#1a1204] flex items-center justify-center disabled:opacity-35 disabled:cursor-not-allowed hover:brightness-105 active:scale-95 transition-all"
            >
              <ArrowUp className="w-4 h-4" strokeWidth={2.5} />
            </button>
          </div>
          <div className="mt-2 px-1 flex items-center justify-center gap-1.5 flex-wrap text-center text-[11px] text-muted">
            <span>{MODELS[model].label}</span>
            <span className="opacity-40">·</span>
            <span>Beacon can make mistakes — check anything important.</span>
            {ragNote && (
              <>
                <span className="opacity-40">·</span>
                <span className="text-lamp/90">{ragNote}</span>
              </>
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
