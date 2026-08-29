// Client-side bearer-token attachment for server functions.
//
// Replaces the generated `attachSupabaseAuth`, which forwards whatever
// `getSession()` returns. On a long-lived tab (or a self-hosted deploy that has
// been restarted) that can be an already-expired access token, so every serverFn
// fails with "Unauthorized: Invalid token" and the app shows
// "Couldn't load your profile". Here the token is refreshed before it is used,
// and an unrecoverable session is cleared so the user lands on /auth instead of
// an error wall.
import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";

/** Refresh when the access token expires within this window (seconds). */
const SKEW_SECONDS = 60;

async function freshAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) return null;

  const expiresAt = session.expires_at ?? 0;
  const nowSec = Math.floor(Date.now() / 1000);
  if (expiresAt - SKEW_SECONDS > nowSec) return session.access_token;

  const refreshed = await supabase.auth.refreshSession();
  if (refreshed.error || !refreshed.data.session) {
    // The refresh token is gone or no longer valid for this project: stop
    // sending a dead bearer token and send the user back to sign-in.
    await supabase.auth.signOut().catch(() => undefined);
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/auth")) {
      window.location.assign("/auth");
    }
    return null;
  }
  return refreshed.data.session.access_token;
}

export const attachFreshSupabaseAuth = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    const token = await freshAccessToken();
    return next({ headers: token ? { Authorization: `Bearer ${token}` } : {} });
  },
);
