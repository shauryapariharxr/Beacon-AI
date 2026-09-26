import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#0f1218",
        panel: "#171b23",
        panel2: "#1d222c",
        border: "#272d3a",
        ink: "#eef0f4",
        muted: "#8b91a1",
        lamp: "#e8a33d",
        lampdim: "#8a6428",
      },
      fontFamily: {
        // `serif` is the display/brand role in this codebase (headings use
        // font-serif) — it now resolves to Poppins.
        serif: ["'Poppins'", "'Inter'", "system-ui", "sans-serif"],
        sans: ["'Inter'", "'Poppins'", "system-ui", "sans-serif"],
        // Real monospace: inline `code` styling depends on fixed-width glyphs.
        mono: ["'JetBrains Mono'", "ui-monospace", "'Cascadia Mono'", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
