// KB ingest: turn parsed export items into summarized TinyWiki KB articles
// saved into public.procedures for the caller. Implementation lives in
// kb-ingest.server.ts; this file is a thin server-function wrapper.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type {
  IngestMode,
  IngestResult,
  IngestSourceInput,
} from "@/lib/kb-ingest.server";

export type {
  IngestMode,
  IngestResult,
  IngestSourceInput,
  IngestedArticle,
} from "@/lib/kb-ingest.server";

export const ingestKbArticles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(async (d: { items: IngestSourceInput[]; mode: IngestMode }) => {
    const { normalizeIngestInput } = await import("@/lib/kb-ingest.server");
    return normalizeIngestInput(d);
  })
  .handler(async ({ context, data }): Promise<IngestResult> => {
    const { withIdempotency } = await import("@/lib/ai-idempotency.server");
    const { runIngest } = await import("@/lib/kb-ingest.server");
    return withIdempotency(
      {
        supabase: context.supabase,
        userId: context.userId,
        surface: "kb.ingest",
        input: {
          mode: data.mode,
          ids: data.items.map((i) => `${i.id}:${i.text.length}`),
        },
      },
      () => runIngest(context, data),
    );
  });
