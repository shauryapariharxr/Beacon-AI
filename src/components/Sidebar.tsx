"use client";

import Link from "next/link";
import Image from "next/image";

type Conversation = { id: string; title: string; createdAt: number };

export function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNewChat,
  userEmail,
  onLogout,
}: {
  conversations: Conversation[];
  activeId?: string;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  userEmail: string;
  onLogout: () => void;
}) {
  return (
    <div className="w-64 shrink-0 glass flex flex-col h-full rounded-none md:rounded-r-2xl md:my-3 md:ml-3">
      <div className="p-3 flex items-center gap-2.5 border-b border-white/[0.06]">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/logo.svg" alt="" width={22} height={22} />
          <span className="font-serif text-base">Beacon</span>
        </Link>
      </div>
      <div className="p-3">
        <button
          onClick={onNewChat}
          className="w-full text-left px-3 py-2 rounded-lg border border-white/10 hover:border-lamp/60 hover:bg-white/[0.05] transition-colors text-sm"
        >
          + New chat
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 space-y-1">
        {conversations.length === 0 && (
          <p className="px-3 py-2 text-xs text-muted">
            No saved chats yet — start one and it&apos;ll show up here.
          </p>
        )}
        {conversations.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm truncate transition-colors ${
              c.id === activeId ? "bg-white/[0.07] text-ink" : "text-muted hover:bg-white/[0.04]"
            }`}
          >
            {c.title || "Untitled chat"}
          </button>
        ))}
      </div>
      <div className="p-3 border-t border-white/[0.06] flex items-center justify-between">
        <span className="text-xs text-muted truncate">{userEmail}</span>
        <button onClick={onLogout} className="text-xs text-muted hover:text-ink transition-colors">
          Log out
        </button>
      </div>
    </div>
  );
}
