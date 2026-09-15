"use client";

import Link from "next/link";
import Image from "next/image";
import { Plus, MessageSquare, Trash2, X } from "lucide-react";

type Conversation = { id: string; title: string; createdAt: number };

export function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNewChat,
  onDelete,
  userEmail,
  userName,
  mobileOpen = false,
  onClose,
  onNavigate,
}: {
  conversations: Conversation[];
  activeId?: string;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onDelete: (id: string) => void;
  userEmail: string;
  userName?: string;
  mobileOpen?: boolean;
  onClose?: () => void;
  onNavigate?: () => void;
}) {
  const displayName = (userName && userName.trim()) || (userEmail ? userEmail.split("@")[0] : "");
  const initial = displayName ? displayName[0].toUpperCase() : "?";

  return (
    <>
      {/* Mobile backdrop — tap to dismiss the drawer */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] md:hidden animate-fade-in"
          onClick={onClose}
          aria-hidden
        />
      )}

      <div
        className={`fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] panel-flat border-r flex flex-col h-full
          transition-transform duration-200 ease-out will-change-transform
          md:static md:z-auto md:w-64 md:shrink-0 md:max-w-none md:translate-x-0
          ${mobileOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"}`}
      >
        <div className="p-4 flex items-center gap-2.5">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/logo.svg" alt="" width={28} height={28} />
            <span className="font-serif font-semibold text-base">Beacon</span>
          </Link>
          <button
            onClick={onClose}
            className="ml-auto md:hidden p-1.5 -mr-1 rounded-lg text-muted hover:text-ink hover:bg-white/[0.06] transition-colors"
            aria-label="Close menu"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        <div className="px-3 pb-3">
          <button
            onClick={() => {
              onNewChat();
              onNavigate?.();
            }}
            className="w-full flex items-center justify-center gap-1.5 bg-gradient-to-r from-lamp to-orange-500 text-[#1a1204] font-semibold rounded-xl py-2.5 text-sm hover:brightness-105 active:brightness-95 transition-all"
          >
            <Plus className="w-4 h-4" strokeWidth={2.5} />
            New Chat
          </button>
        </div>

        <div className="px-4 pb-1.5 text-xs font-medium tracking-wide text-muted uppercase">
          History
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-2 space-y-1">
          {conversations.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted">
              No saved chats yet — start one and it&apos;ll show up here.
            </p>
          )}
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center gap-2 px-3 py-2.5 md:py-2 rounded-lg text-sm cursor-pointer transition-colors ${
                c.id === activeId ? "bg-white/[0.07] text-ink" : "text-muted hover:bg-white/[0.04]"
              }`}
              onClick={() => {
                onSelect(c.id);
                onNavigate?.();
              }}
            >
              <MessageSquare className="w-3.5 h-3.5 shrink-0" />
              <span className="flex-1 truncate">{c.title || "Untitled chat"}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(c.id);
                }}
                className="opacity-60 md:opacity-0 md:group-hover:opacity-100 text-muted hover:text-red-400 transition-opacity shrink-0 p-1 -m-1"
                aria-label="Delete chat"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        <div className="p-3 pt-safe border-t border-white/[0.06] flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-lamp/90 text-[#1a1204] flex items-center justify-center text-sm font-semibold shrink-0">
            {initial}
          </div>
          <div className="min-w-0">
            <div className="text-sm text-ink truncate capitalize">{displayName}</div>
            <div className="text-xs text-muted truncate">{userEmail}</div>
          </div>
        </div>
      </div>
    </>
  );
}
