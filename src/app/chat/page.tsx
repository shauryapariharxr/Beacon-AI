"use client";

import Link from "next/link";
import { ChatWindow } from "@/components/ChatWindow";

export default function GuestChatPage() {
  return (
    <div className="h-dvh flex flex-col">
      {/* Slim top bar — brand on the left, guest actions on the right. */}
      <div className="shrink-0 flex items-center gap-2 px-3 sm:px-4 py-2 pt-safe border-b border-white/[0.06]">
        <Link
          href="/"
          aria-label="Beacon home"
          className="-ml-1.5 flex items-center gap-2 rounded-full px-1.5 py-1 hover:bg-white/[0.05] transition-colors"
        >
          <img src="/logo.svg" alt="" className="w-6 h-6" />
          <span className="font-serif font-semibold text-[15px] text-ink">Beacon</span>
        </Link>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-3">
          <span className="hidden lg:flex items-center gap-1.5 text-xs text-muted">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            Guest mode — chats aren&apos;t saved
          </span>
          <Link
            href="/contact"
            className="hidden sm:inline px-2 text-xs text-muted hover:text-ink transition-colors"
          >
            Contact
          </Link>
          <Link
            href="/login"
            className="px-2.5 py-1.5 text-xs text-muted hover:text-ink rounded-full hover:bg-white/[0.06] transition-colors"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="text-xs bg-gradient-to-r from-lamp to-orange-500 text-[#1a1204] font-semibold px-3 py-1.5 rounded-full hover:brightness-105 transition-all"
          >
            Sign up
          </Link>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <ChatWindow isAuthed={false} />
      </div>
    </div>
  );
}
