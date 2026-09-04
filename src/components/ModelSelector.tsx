"use client";

import { MODELS, ModelKey } from "@/lib/models";

export function ModelSelector({
  value,
  onChange,
}: {
  value: ModelKey;
  onChange: (v: ModelKey) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as ModelKey)}
      className="bg-panel2 border border-border rounded-lg px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-lamp"
    >
      {Object.entries(MODELS).map(([key, m]) => (
        <option key={key} value={key}>
          {m.label} — {m.description}
        </option>
      ))}
    </select>
  );
}
