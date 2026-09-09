"use client";

import { useState } from "react";
import { Zap, ChevronDown, Check } from "lucide-react";
import { MODELS, ModelKey } from "@/lib/models";

export function ModelSelector({
  value,
  onChange,
}: {
  value: ModelKey;
  onChange: (v: ModelKey) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="glass rounded-full pl-3 pr-2.5 py-1.5 text-sm text-ink flex items-center gap-1.5 hover:bg-white/[0.07] transition-colors"
      >
        <Zap className="w-3.5 h-3.5 text-lamp" />
        {MODELS[value].label}
        <ChevronDown className="w-3.5 h-3.5 text-muted" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-2 w-64 glass-strong rounded-xl p-1.5 z-50">
            {Object.entries(MODELS).map(([key, m]) => (
              <button
                key={key}
                onClick={() => {
                  onChange(key as ModelKey);
                  setOpen(false);
                }}
                className="w-full flex items-start gap-2 text-left px-3 py-2 rounded-lg hover:bg-white/[0.06] transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-ink">{m.label}</div>
                  <div className="text-xs text-muted">{m.description}</div>
                </div>
                {key === value && <Check className="w-4 h-4 text-lamp shrink-0 mt-0.5" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
