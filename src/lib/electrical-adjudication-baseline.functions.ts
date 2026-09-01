// Phase 4.4 — build the SHA-bound canonical ODS baseline for load adjudication.
//
// The workbook is parsed in memory and hashed exactly the way Parallel
// Validation does it, so adjudication and validation are tied to the same
// cryptographic identity. Nothing is written: no database rows, no .ods file.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAddon } from "@/lib/addons.server";
import { parseOdsContentXml } from "@/lib/electrical-ods";
import {
  makeAdjudicationBaseline,
  type AdjudicationBaseline,
} from "@/lib/electrical-adjudication-baseline";

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export const odsBaselineInput = z.object({
  file_name: z.string().trim().min(1).max(200),
  base64: z.string().min(1).max(30_000_000),
});

/** Parse + hash the workbook and return the canonical baseline. Read-only. */
export async function baselineFromUpload(
  data: z.infer<typeof odsBaselineInput>,
): Promise<AdjudicationBaseline> {
  const { unzipSync, strFromU8 } = await import("fflate");
  const bytes = base64ToBytes(data.base64);
  const ods_sha256 = await sha256Hex(bytes);
  const files = unzipSync(bytes, { filter: (f) => f.name === "content.xml" });
  const content = files["content.xml"];
  if (!content) {
    throw new Error("That file does not look like an .ods spreadsheet (no content.xml).");
  }
  const sheets = parseOdsContentXml(strFromU8(content));
  return makeAdjudicationBaseline({
    ods_file_name: data.file_name,
    ods_sha256,
    sheets,
  });
}

export const buildAdjudicationBaseline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => odsBaselineInput.parse(d))
  .handler(async ({ context, data }): Promise<AdjudicationBaseline> => {
    await requireAddon(context.supabase, context.userId, "electrical");
    return baselineFromUpload(data);
  });
