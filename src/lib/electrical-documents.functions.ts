// Document generation source: the same API handler an external caller reaches at
// GET /api/electrical/v1/documents/bundle, invoked in-process with the signed-in
// user's session. The screen never queries tables directly, so an in-app print
// and an API-generated print are byte-identical in content.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { DocumentBundle } from "@/lib/electrical-documents";

export interface DocumentBundleResult {
  bundle: DocumentBundle;
  /** Who the version stamp credits for the print. */
  generatedBy: string;
  /** API version this bundle came from. */
  apiVersion: string;
}

export const getElectricalDocumentBundle = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DocumentBundleResult> => {
    const { requireElectricalAccess } = await import("@/lib/addons.server");
    await requireElectricalAccess(context.supabase, context.userId, "read");

    const { handleApiRead } = await import("@/lib/electrical-api.server");
    const { ELECTRICAL_API_VERSION } = await import("@/lib/electrical-api");
    const res = await handleApiRead(
      { supabase: context.supabase, userId: context.userId },
      ["documents", "bundle"],
    );
    const body = (await res.json()) as DocumentBundle & { error?: string };
    if (!res.ok || body.error) {
      throw new Error(body.error || `Document bundle request failed (${res.status}).`);
    }

    const claims = (context as { claims?: Record<string, unknown> }).claims ?? {};
    const email = typeof claims["email"] === "string" ? (claims["email"] as string) : "";
    return {
      bundle: body,
      generatedBy: email || context.userId,
      apiVersion: ELECTRICAL_API_VERSION,
    };
  });
