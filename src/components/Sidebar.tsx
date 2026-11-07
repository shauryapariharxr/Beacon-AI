"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Plus, MessageSquare, Trash2, X, LogOut } from "lucide-react";
import { ConfirmLogoutDialog } from "./ConfirmLogoutDialog";
import { Avatar } from "./Avatar";
import { hardLogout } from "@/lib/hardLogout";

type Conversation = { id: string; title: string; createdAt: number };

export function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNewChat,
  onDelete,
  userEmail,
  userName,
  avatarUrl,
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
  avatarUrl?: string | null;
  mobileOpen?: boolean;
  onClose?: () => void;
  onNavigate?: () => void;
}) {
  const displayName = (userName && userName.trim()) || (userEmail ? userEmail.split("@")[0] : "");
  const initial = displayName ? displayName[0].toUpperCase() : "?";
  // The Beacon mark in this sidebar used to be a plain link to "/" — one
  // accidental tap (it sits right above the history list) silently ended the
  // session. It now asks first; confirming logs out, cancelling stays put.
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    // Hard navigation: drops the signed-in SPA shell from history and the
    // back/forward cache, so Back/Forward can't resurrect the dashboard.
    await hardLogout("/api/auth/logout", "/");
  }

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
        className={`fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-[#0d0d0e] border-r border-white/[0.07] flex flex-col h-full
          transition-transform duration-200 ease-out will-change-transform
          md:static md:z-auto md:w-[260px] md:shrink-0 md:max-w-none md:translate-x-0
          ${mobileOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"}`}
      >
        <div className="p-4 flex items-center gap-2.5">
          <button
            onClick={() => setConfirmLogout(true)}
            aria-label="Beacon home — opens the log out confirmation"
            title="Log out"
            className="flex items-center gap-2.5 rounded-lg hover:bg-white/[0.05] transition-colors px-1 py-0.5 -mx-1"
          >
            <Image src="/logo.svg" alt="" width={28} height={28} />
            <span className="font-serif font-semibold text-base">Beacon</span>
          </button>
          <button
            onClick={onClose}
            className="ml-auto md:hidden p-1.5 -mr-1 rounded-lg text-muted hover:text-ink hover:bg-white/[0.06] transition-colors"
            aria-label="Close menu"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        <div className="px-2 pb-2">
          <button
            onClick={() => {
              onNewChat();
              onNavigate?.();
            }}
            className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-ink bg-white/[0.06] hover:bg-white/[0.10] active:scale-[0.99] transition-all"
          >
            <span className="w-6 h-6 rounded-full border border-white/20 flex items-center justify-center shrink-0">
              <Plus className="w-3.5 h-3.5" strokeWidth={2.2} />
            </span>
            New chat
          </button>
        </div>

        <div className="px-4 pb-1.5 pt-1 text-[11px] font-medium tracking-wide text-muted uppercase">
          Chats
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

        {/* Account row is the desktop home for the profile photo. Clicking it
            opens the log-out confirmation (same guard as before) — on mobile
            the same menu lives behind the floating avatar in the header. */}
        <div className="p-2 pb-safe border-t border-white/[0.06]">
          <button
            onClick={() => setConfirmLogout(true)}
            className="w-full flex items-center gap-2.5 rounded-xl px-2 py-2 hover:bg-white/[0.06] transition-colors text-left"
            aria-label="Account — log out"
          >
            <Avatar url={avatarUrl} name={displayName} size={28} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] text-ink truncate capitalize">{displayName}</div>
              <div className="text-[11px] text-muted truncate">{userEmail}</div>
            </div>
            <LogOut className="w-4 h-4 text-muted shrink-0" />
          </button>
        </div>

        <ConfirmLogoutDialog
          open={confirmLogout}
          busy={loggingOut}
          onCancel={() => setConfirmLogout(false)}
          onConfirm={handleLogout}
        />
      </div>
    </>
  );
}
