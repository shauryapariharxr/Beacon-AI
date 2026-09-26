"use client";

import { useEffect, useRef } from "react";
import { LogOut, X } from "lucide-react";

/**
 * Confirmation dialog for logging out.
 *
 * A stray tap on the avatar/menu button (the same corner of the screen as
 * everything else) used to end the session instantly with no way back. One
 * modal stands between the click and the logout; Escape and the backdrop
 * cancel, focus moves to the risky action so akeyboard-only Enter confirms
 * deliberately, and page scroll locks while it is open.
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

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center px-4 bg-black/60 backdrop-blur-[2px] animate-fade-in"
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
        className="glass-strong rounded-2xl p-6 w-full max-w-sm animate-pop-in"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="w-10 h-10 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center shrink-0">
            <LogOut className="w-4.5 h-4.5 text-red-400" />
          </div>
          <button
            onClick={onCancel}
            disabled={busy}
            aria-label="Cancel"
            className="p-1.5 -m-1 rounded-lg text-muted hover:text-ink hover:bg-white/[0.06] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <h2 id="logout-title" className="mt-4 font-serif font-semibold text-lg text-ink">
          Log out of Beacon?
        </h2>
        <p id="logout-desc" className="mt-1.5 text-sm text-muted leading-relaxed">
          Your conversations stay saved. You can log back in any time.
        </p>

        <div className="mt-5 flex gap-2.5">
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 h-10 rounded-xl surface-2 text-sm text-ink hover:bg-white/[0.09] transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 h-10 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-400 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {busy && (
              <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
            )}
            {busy ? "Logging out…" : "Log out"}
          </button>
        </div>
      </div>
    </div>
  );
}
