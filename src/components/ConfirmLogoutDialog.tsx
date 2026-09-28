"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LogOut } from "lucide-react";

/**
 * Confirmation dialog for logging out.
 *
 * Rendered through a React PORTAL to document.body. This matters: the
 * dashboard sidebar uses transform-based slide-in classes, and a transformed
 * ancestor becomes the containing block for `position: fixed` — the dialog
 * opened from the sidebar used to be trapped inside the 288px-wide panel,
 * clipped and squeezed against its left edge. A portal lifts the dialog out
 * of any transformed/filtered ancestor, so it always covers the viewport.
 *
 * Design notes: one quiet icon, no redundant close button (Cancel, Escape
 * and the backdrop all dismiss), focus lands on the risky action so a
 * keyboard-only Enter confirms deliberately, and page scroll locks while
 * the dialog is open.
 */
export function ConfirmLogoutDialog({
  open,
  busy = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  // Portals need a real DOM node; skip SSR entirely.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, busy, onCancel]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center px-4 bg-black/70 backdrop-blur-sm animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="logout-title"
        aria-describedby="logout-desc"
        className="w-full max-w-[360px] rounded-2xl border border-white/10 bg-[#151a23] shadow-[0_24px_64px_-12px_rgba(0,0,0,0.7)] p-6 animate-pop-in"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-red-500/10 border border-red-500/25 flex items-center justify-center shrink-0">
            <LogOut className="w-4 h-4 text-red-400" />
          </div>
          <h2 id="logout-title" className="font-serif font-semibold text-lg text-ink">
            Log out of Beacon?
          </h2>
        </div>

        <p id="logout-desc" className="mt-3 text-sm text-muted leading-relaxed">
          Your conversations stay saved. You can log back in any time.
        </p>

        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5">
          <button
            onClick={onCancel}
            disabled={busy}
            className="h-10 px-4 rounded-xl border border-white/10 text-sm text-muted hover:text-ink hover:bg-white/[0.05] transition-colors disabled:opacity-50 sm:min-w-[96px]"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            disabled={busy}
            className="h-10 px-4 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-400 active:bg-red-600 transition-colors disabled:opacity-60 flex items-center justify-center gap-2 sm:min-w-[110px]"
          >
            {busy && (
              <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
            )}
            {busy ? "Logging out…" : "Log out"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
