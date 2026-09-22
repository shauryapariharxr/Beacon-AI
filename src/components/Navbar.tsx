"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { Code2, Menu, X } from "lucide-react";

const LINKS = [
  { label: "Try it", href: "/#demo" },
  { label: "Models", href: "/#models" },
  { label: "How it works", href: "/#how-it-works" },
  { label: "Contact", href: "/contact" },
];

const GITHUB_URL = "https://github.com/shauryapariharxr/Beacon-AI";

export function Navbar() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 flex justify-center pt-3 px-3">
      <div className="glass-nav w-full max-w-5xl rounded-[50px] pl-6 pr-4 py-2.5 flex items-center justify-between">
        <Link href="/" onClick={() => setOpen(false)}>
          <Image src="/logo.svg" alt="Beacon" width={30} height={30} className="ml-1" priority />
        </Link>

        {/* Desktop links — stagger in on load, lift on hover */}
        <motion.nav
          className="hidden md:flex items-center gap-1 text-sm text-muted"
          initial="hidden"
          animate="show"
          variants={{
            hidden: {},
            show: { transition: { staggerChildren: 0.06, delayChildren: 0.15 } },
          }}
        >
          {LINKS.map((l) => (
            <motion.div
              key={l.label}
              variants={{
                hidden: { opacity: 0, y: -8 },
                show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
              }}
            >
              <motion.div
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.95 }}
                transition={{ type: "spring", stiffness: 400, damping: 20 }}
              >
                <Link
                  href={l.href}
                  className="inline-block px-2.5 py-1.5 hover:text-ink transition-colors"
                >
                  {l.label}
                </Link>
              </motion.div>
            </motion.div>
            ))}
          </motion.nav>

        <div className="flex items-center gap-3">
          {/* Source-code icon — spins slightly + lifts on hover */}
          <motion.div
            whileHover={{ y: -2, rotate: 8 }}
            whileTap={{ scale: 0.9 }}
            transition={{ type: "spring", stiffness: 400, damping: 20 }}
          >
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Source code"
              title="Source code"
              className="flex items-center justify-center text-muted hover:text-ink transition-colors"
            >
              <Code2 className="w-[18px] h-[18px]" />
            </a>
          </motion.div>

          <Link
            href="/login"
            className="hidden sm:block text-sm bg-gradient-to-r from-lamp to-orange-500 text-[#1a1204] font-semibold px-3.5 py-1.5 rounded-full hover:brightness-105 transition-all"
          >
            Log in
          </Link>

          {/* Mobile hamburger */}
          <button
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            className="md:hidden w-9 h-9 rounded-full flex items-center justify-center text-muted hover:text-ink hover:bg-white/[0.08] transition-colors"
          >
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.97 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="md:hidden absolute top-[calc(100%+8px)] left-3 right-3 glass-nav rounded-2xl p-2 shadow-[0_20px_50px_rgba(0,0,0,0.5)]"
          >
            {LINKS.map((l, i) => (
              <motion.div
                key={l.label}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.05 + i * 0.05, duration: 0.25, ease: "easeOut" }}
              >
                <Link
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="block px-4 py-3 rounded-xl text-sm text-muted hover:text-ink hover:bg-white/[0.06] transition-colors"
                >
                  {l.label}
                </Link>
              </motion.div>
            ))}
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="sm:hidden block text-center px-4 py-3 rounded-xl text-sm font-semibold bg-gradient-to-r from-lamp to-orange-500 text-[#1a1204]"
            >
              Log in
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
