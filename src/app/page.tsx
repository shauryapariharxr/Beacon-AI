"use client";

import Link from "next/link";
import { ChatWindow } from "@/components/ChatWindow";

export default function HomePage() {
  return (
    <div className="flex flex-col h-screen">
      <div className="flex justify-end gap-3 px-4 py-2 border-b border-border bg-panel/50">
        <Link href="/login" className="text-sm text-muted hover:text-ink">
          Log in
        </Link>
        <Link
          href="/signup"
          className="text-sm bg-lamp text-[#1a1204] font-medium px-3 py-1 rounded-lg hover:bg-lamp/90"
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
