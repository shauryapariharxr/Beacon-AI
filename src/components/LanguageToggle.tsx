"use client";

import { useState } from "react";
import { Globe, ChevronDown, Check } from "lucide-react";
import { LANGS, Lang } from "@/lib/i18n";

export function LanguageToggle({ value, onChange }: { value: Lang; onChange: (v: Lang) => void }) {
  const [open, setOpen] = useState(false);
  const current = LANGS.find((l) => l.key === value);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="surface-2 rounded-full pl-3 pr-2.5 py-1.5 text-sm text-ink flex items-center gap-1.5 hover:bg-white/[0.09] transition-colors"
      >
        <Globe className="w-3.5 h-3.5 text-muted" />
        {current?.label}
        <ChevronDown className="w-3.5 h-3.5 text-muted" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-40 glass-strong rounded-xl p-1.5 z-50">
            {LANGS.map((l) => (
              <button
                key={l.key}
                onClick={() => {
                  onChange(l.key);
                  setOpen(false);
                }}
                className="w-full flex items-center justify-between text-left px-3 py-2 rounded-lg text-sm text-ink hover:bg-white/[0.06] transition-colors"
              >
                {l.label}
                {l.key === value && <Check className="w-4 h-4 text-lamp" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
