import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Beacon",
  description: "A free AI study buddy, built with Next.js and Groq",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-ink antialiased">{children}</body>
    </html>
  );
}
