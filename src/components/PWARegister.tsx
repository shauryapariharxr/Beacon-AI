"use client";

import { useEffect } from "react";

// Registers the root service worker (public/sw.js). This is what makes the
// site qualify for Chrome/Edge/Brave's "install app" control in the address
// bar — the manifest alone is not enough on those browsers. Nothing renders.
export function PWARegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Register after load so it never competes with the first paint.
    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // Non-fatal: without it the app just runs as a normal tab.
      });
    };
    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
