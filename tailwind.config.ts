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
        serif: ["'Space Grotesk'", "system-ui", "sans-serif"],
        sans: ["'Space Grotesk'", "system-ui", "sans-serif"],
        mono: ["'Space Grotesk'", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
