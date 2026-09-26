/**
 * End a session with a HARD navigation.
 *
 * Logging out through the SPA router (`router.push/replace`) leaves the
 * signed-in page alive in this tab's history: Back re-renders it from the
 * router cache, and the browser may keep a back/forward-cache copy that never
 * touches the server. Replacing the whole document drops both, and navigating
 * truncates the forward entries — so after logout, Forward has nothing to
 * re-enter and Back can only reach the login form (the server gate on
 * /dashboard and /admin enforces that regardless).
 */
export async function hardLogout(endpoint: string, target: string): Promise<void> {
  try {
    await fetch(endpoint, { method: "POST" });
  } catch {
    // Clear the tab even if the request failed: the cookie may already be
    // gone server-side, and every protected navigation re-checks the session.
  }
  location.replace(target);
}
