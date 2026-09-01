import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

/** Only same-origin app paths are accepted, so a scanned QR can't bounce off-site. */
export function safeRedirectPath(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  if (!raw.startsWith("/") || raw.startsWith("//")) return undefined;
  if (raw.startsWith("/auth")) return undefined;
  return raw;
}

export async function requireAuthenticatedUser(opts?: {
  location?: { href?: string };
}) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    const target = safeRedirectPath(opts?.location?.href);
    throw redirect({ to: "/auth", search: { redirect: target } });
  }
  return { user: data.user };
}
