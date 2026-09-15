"use client";

import Link from "next/link";
import { ArrowLeft, Maximize2 } from "lucide-react";
import { ChatWindow } from "@/components/ChatWindow";

export default function GuestChatPage() {
  return (
    <div className="h-dvh flex flex-col">
      {/* Slim top bar — back to home + branding, chat fills the rest */}
      <div className="shrink-0 h-11 px-4 flex items-center gap-3 border-b border-white/[0.06]">
        <Link
          href="/"
          className="flex items-center gap-1.5 text-sm text-muted hover:text-ink transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Home
        </Link>
        <Link href="/" className="flex items-center gap-2 ml-1">
          <img src="/logo.svg" alt="Beacon" className="w-5 h-5" />
          <span className="font-serif font-semibold text-sm text-ink">Beacon</span>
        </Link>
        <span className="ml-auto text-xs text-muted hidden md:flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          Guest mode — sign up to save your chats
        </span>
        <Link
          href="/contact"
          className="text-xs text-muted hover:text-ink transition-colors"
        >
          Contact
        </Link>
        <Link
          href="/signup"
          className="text-xs bg-gradient-to-r from-lamp to-orange-500 text-[#1a1204] font-semibold px-3 py-1.5 rounded-full hover:brightness-105 transition-all"
        >
          Sign up
        </Link>
      </div>
      <div className="flex-1 min-h-0">
        <ChatWindow isAuthed={false} />
      </div>
    </div>
  );
}
