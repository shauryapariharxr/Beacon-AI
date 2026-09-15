import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Beacon — Your free AI study buddy",
    template: "%s | Beacon",
  },
  description:
    "Ask a question, get an answer instantly — no signup needed. Beacon is a free AI study companion for students and developers, with optional accounts to save your chat history.",
  keywords: ["AI study buddy", "free AI chat", "AI tutor", "Beacon AI", "Groq", "study assistant"],
  authors: [{ name: "Shaurya Parihar" }],
  icons: {
    icon: "/logo.svg",
  },
  openGraph: {
    title: "Beacon — Your free AI study buddy",
    description:
      "Ask anything, get instant answers. No signup needed — free forever, powered by fast open models.",
    type: "website",
    siteName: "Beacon",
  },
  twitter: {
    card: "summary",
    title: "Beacon — Your free AI study buddy",
    description: "Ask anything, get instant answers. No signup needed.",
  },
};

// Mobile: device-width + cover so the chat input clears the iOS home
// indicator; resizes-content makes the Android keyboard shrink the layout
// instead of covering it.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#0f1218",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-ink antialiased">{children}</body>
    </html>
  );
}
