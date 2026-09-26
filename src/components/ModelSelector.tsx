"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Zap, ChevronDown, Check, Lock } from "lucide-react";
import { MODELS, ModelKey } from "@/lib/models";

export function ModelSelector({
  value,
  onChange,
  isAuthed,
  dropUp = false,
}: {
  value: ModelKey;
  onChange: (v: ModelKey) => void;
  isAuthed: boolean;
  // The selector lives at the bottom of the screen inside the composer, so its
  // menu has to open upward or it lands off-screen.
  dropUp?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  // Guests are limited to Flash; the rest unlock after signing in.
  const isLocked = (key: ModelKey) => !isAuthed && key !== "flash";

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="surface-2 rounded-full pl-3 pr-2.5 py-1.5 text-sm text-ink flex items-center gap-1.5 hover:bg-white/[0.09] transition-colors"
      >
        <Zap className="w-3.5 h-3.5 text-lamp" />
        {MODELS[value].label}
        <ChevronDown className="w-3.5 h-3.5 text-muted" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className={`absolute left-0 w-64 glass-strong rounded-xl p-1.5 z-50 ${
              dropUp ? "bottom-full mb-2" : "top-full mt-2"
            }`}
          >
            {Object.entries(MODELS).map(([key, m]) => {
              const locked = isLocked(key as ModelKey);
              return (
                <button
                  key={key}
                  onClick={() => {
                    if (locked) {
                      router.push("/signup");
                      return;
                    }
                    onChange(key as ModelKey);
                    setOpen(false);
                  }}
                  className={`w-full flex items-start gap-2 text-left px-3 py-2 rounded-lg transition-colors ${
                    locked
                      ? "opacity-60 hover:bg-white/[0.04]"
                      : "hover:bg-white/[0.06]"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-ink flex items-center gap-1.5">
                      {m.label}
                      {locked && <Lock className="w-3 h-3 text-muted" />}
                    </div>
                    <div className="text-xs text-muted">
                      {locked ? "Sign in to unlock" : m.description}
                    </div>
                  </div>
                  {key === value && <Check className="w-4 h-4 text-lamp shrink-0 mt-0.5" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
