"use client";

import { useEffect, useState } from "react";

const SENTINEL_KEY = "beaconLogoutGuard";

/**
 * Intercept the browser's Back button on protected pages (dashboard, admin).
 *
 * On mount the hook pushes a hidden history entry — the "sentinel" — in front
 * of the page entry. The first Back press therefore moves *within the same
 * document* (a popstate we can observe) instead of unconditionally leaving:
 * the page shows its logout confirmation, and:
 *   - Cancel hops forward onto the sentinel again, so the next Back is
 *     intercepted too.
 *   - Confirm performs the logout via a hard navigation (see hardLogout),
 *     which truncates the forward entries — so Forward can never resurrect
 *     the dashboard after logging out.
 *
 * Pressing Forward while the dialog is open simply lands on the sentinel and
 * closes the dialog, which is the natural outcome.
 */
export function useBackLogoutGuard() {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    // Push the sentinel once. (React strict mode runs effects twice in dev —
    // don't stack two sentinels, or Back would need a second press.)
    const current = history.state as Record<string, unknown> | null;
    if (!current || !current[SENTINEL_KEY]) {
      // Carry Next's own history state along so its router still recognises
      // the entry as internal when it lands back on it.
      history.pushState({ ...current, [SENTINEL_KEY]: true }, "");
    }

    const onPopState = (event: PopStateEvent) => {
      const state = event.state as Record<string, unknown> | null;
      if (state && state[SENTINEL_KEY]) {
        // Arrived on the guard entry (cancel hop, or manual Forward): any
        // open dialog resolves as cancelled.
        setConfirming(false);
        return;
      }
      // Left the guard entry via Back: ask before ending the session.
      setConfirming(true);
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  /**
   * Resolve the confirmation dialog. `confirmed === false` restores the
   * sentinel position; `confirmed === true` is a no-op here because the
   * caller performs the logout (and the hard navigation discards the stack).
   */
  function settle(confirmed: boolean) {
    if (confirmed) return;
    setConfirming(false);
    // If the dialog was opened by Back we are sitting on the real entry:
    // hop forward to the sentinel so Back stays intercepted.
    const state = history.state as Record<string, unknown> | null;
    if (!state || !state[SENTINEL_KEY]) history.go(1);
  }

  return { confirming, settle };
}
