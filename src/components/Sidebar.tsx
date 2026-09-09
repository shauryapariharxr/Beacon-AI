"use client";

import Link from "next/link";
import Image from "next/image";
import { Plus, MessageSquare, Trash2 } from "lucide-react";

type Conversation = { id: string; title: string; createdAt: number };

export function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNewChat,
  onDelete,
  userEmail,
}: {
  conversations: Conversation[];
  activeId?: string;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onDelete: (id: string) => void;
  userEmail: string;
}) {
  const initial = userEmail ? userEmail[0].toUpperCase() : "?";
  const displayName = userEmail ? userEmail.split("@")[0] : "";

  return (
    <div className="w-64 shrink-0 glass flex flex-col h-full rounded-none md:rounded-r-2xl md:my-3 md:ml-3">
      <div className="p-4 flex items-center gap-2.5">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/logo.svg" alt="" width={24} height={24} />
          <span className="font-serif font-semibold text-base">Beacon</span>
        </Link>
      </div>

      <div className="px-3 pb-3">
        <button
          onClick={onNewChat}
          className="w-full flex items-center justify-center gap-1.5 bg-gradient-to-r from-lamp to-orange-500 text-[#1a1204] font-semibold rounded-xl py-2.5 text-sm hover:brightness-105 transition-all"
        >
          <Plus className="w-4 h-4" strokeWidth={2.5} />
          New Chat
        </button>
      </div>

      <div className="px-4 pb-1.5 text-xs font-medium tracking-wide text-muted uppercase">
        History
      </div>
      <div className="flex-1 overflow-y-auto px-2 space-y-1">
        {conversations.length === 0 && (
          <p className="px-3 py-2 text-xs text-muted">
            No saved chats yet — start one and it&apos;ll show up here.
          </p>
        )}
        {conversations.map((c) => (
          <div
            key={c.id}
            className={`group flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors ${
              c.id === activeId ? "bg-white/[0.07] text-ink" : "text-muted hover:bg-white/[0.04]"
            }`}
            onClick={() => onSelect(c.id)}
          >
            <MessageSquare className="w-3.5 h-3.5 shrink-0" />
            <span className="flex-1 truncate">{c.title || "Untitled chat"}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(c.id);
              }}
              className="opacity-0 group-hover:opacity-100 text-muted hover:text-red-400 transition-opacity shrink-0"
              aria-label="Delete chat"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="p-3 border-t border-white/[0.06] flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-full bg-lamp/90 text-[#1a1204] flex items-center justify-center text-sm font-semibold shrink-0">
          {initial}
        </div>
        <div className="min-w-0">
          <div className="text-sm text-ink truncate capitalize">{displayName}</div>
          <div className="text-xs text-muted truncate">{userEmail}</div>
        </div>
      </div>
    </div>
  );
}
