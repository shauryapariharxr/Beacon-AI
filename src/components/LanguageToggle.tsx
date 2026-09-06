"use client";

import { LANGS, Lang } from "@/lib/i18n";

export function LanguageToggle({ value, onChange }: { value: Lang; onChange: (v: Lang) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as Lang)}
      className="glass rounded-lg px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-lamp cursor-pointer"
    >
      {LANGS.map((l) => (
        <option key={l.key} value={l.key}>
          {l.label}
        </option>
      ))}
    </select>
  );
}
