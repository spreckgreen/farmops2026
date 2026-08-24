// Server-only implementation for KB ingest (see kb-ingest.functions.ts).
export type IngestMode = "per-item" | "grouped";

export interface IngestSourceInput {
  id: string;
  title: string;
  kind: string;
  text: string;
}

export interface IngestedArticle {
  name: string;
  status: "saved" | "renamed" | "failed";
  sources: string[];
  error?: string;
  chars: number;
}

export interface IngestResult {
  /** Set when a local model failed and hosted AI was used instead. */
  escalation?: import("./ai-feature-areas").AiEscalation | null;
  articles: IngestedArticle[];
  skipped: { title: string; reason: string }[];
  model: string;
  mode: IngestMode;
  latencyMs: number;
}

export const MAX_ITEMS = 60;
export const MAX_ITEM_CHARS = 12_000;
const MAX_GROUP_CHARS = 24_000;
const MAX_ARTICLES = 60;

const ARTICLE_SHAPE = `Return GitHub-flavored Markdown only (no code fence around the whole answer), in exactly this shape:

# <Article title>
## Summary
<2-4 sentences>
## Key points
- <bullet>
## Steps
1. <step>   (omit this section entirely if the source has no procedure)
## Notes
- <caveats, numbers, settings worth keeping>
## Sources
- <source titles you used>

Rules: be factual, keep only durable knowledge, drop chit-chat and pleasantries,
keep the whole article under 500 words, never invent facts not in the source.`;

function firstHeading(md: string): string | null {
  const m = md.match(/^\s*#\s+(.+)$/m);
  return m ? m[1].trim().replace(/[#*`]/g, "").slice(0, 110) : null;
}

/** Strip an accidental wrapping code fence some small models add. */
function unfence(text: string): string {
  const t = text.trim();
  const m = t.match(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/);
  return (m ? m[1] : t).trim();
}

/** Normalize the caller-supplied payload; also used by the input validator. */
export function normalizeIngestInput(d: {
  items?: IngestSourceInput[];
  mode?: string;
}): { items: IngestSourceInput[]; mode: IngestMode } {
  const items = Array.isArray(d?.items) ? d.items : [];
  if (!items.length) throw new Error("No source items to ingest.");
  return {
    mode: d?.mode === "grouped" ? "grouped" : "per-item",
    items: items.slice(0, MAX_ITEMS).map((it, i) => ({
      id: String(it?.id ?? `s${i + 1}`),
      title: String(it?.title ?? "Untitled").slice(0, 160),
      kind: String(it?.kind ?? "text").slice(0, 32),
      text: String(it?.text ?? "").slice(0, MAX_ITEM_CHARS),
    })),
  };
}

interface Ctx {
  // Supabase client from requireSupabaseAuth (RLS scoped to the caller).
  supabase: {
    from: (t: string) => any;
  };
  userId: string;
}

export async function runIngest(
  context: Ctx,
  data: { items: IngestSourceInput[]; mode: IngestMode },
): Promise<IngestResult> {
  const started = Date.now();
  const { resolveAreaAi, hostedHandle } = await import("./ai-routing.server");
  const ai = await resolveAreaAi("kb_ingest", {
    hostedDefaultModel: "openai/gpt-5.6-sol",
    // Vault-backed engine keys are readable only with the caller's session.
    client: context.supabase as never,
  });
  let provider = ai.provider;
  let modelId = ai.modelId;
  const modelOverride = ai.backend === "local" ? ai.modelId : undefined;
  const { generateText } = await import("ai");
  const { markdownToTinyWiki } = await import("./md-to-tinywiki");
  const { tidyProcedure } = await import("./tidy-tinywiki");
  const { buildTinyWikiHtml } = await import("./tinywiki");
  let escalation: import("./ai-feature-areas").AiEscalation | null = null;

  const ask = async (system: string, prompt: string) => {
    const call = () =>
      generateText({
        model: provider(modelId),
        system,
        prompt,
      });
    try {
      const res = await call();
      return unfence(res.text ?? "");
    } catch (error) {
      // Local model unreachable or failing — escalate to hosted AI once.
      const hosted = hostedHandle(
        ai,
        "error",
        `${modelId} failed during document ingest, so hosted AI was used instead.`,
      );
      if (!hosted) throw error;
      provider = hosted.provider;
      modelId = hosted.modelId;
      escalation = hosted.escalation;
      const res = await call();
      return unfence(res.text ?? "");
    }
  };

  // Existing names so we never overwrite a hand-written procedure.
  const { data: existingRows } = await context.supabase
    .from("procedures")
    .select("name")
    .eq("user_id", context.userId);
  const taken = new Set<string>(
    (existingRows ?? []).map((r: { name: string }) => String(r.name)),
  );

  const skipped: { title: string; reason: string }[] = [];

  type Unit = { title: string; sources: IngestSourceInput[] };
  let units: Unit[] = data.items.map((it) => ({ title: it.title, sources: [it] }));

  if (data.mode === "grouped" && data.items.length > 1) {
    try {
      const list = data.items
        .map(
          (it) =>
            `${it.id} | ${it.title} | ${it.text.slice(0, 300).replace(/\n/g, " ")}`,
        )
        .join("\n");
      const clustered = await ask(
        "You cluster raw knowledge sources into topics for a farm operations knowledge base. " +
          "Answer with one line per topic in the form: Topic title :: id1, id2, id3. " +
          "Use every id exactly once. Prefer 3-10 topics. No commentary.",
        `Sources (id | title | excerpt):\n${list}`,
      );
      const byId = new Map(data.items.map((it) => [it.id, it]));
      const grouped: Unit[] = [];
      const used = new Set<string>();
      for (const line of clustered.split("\n")) {
        const m = line.match(/^\s*[-*\d.]*\s*(.+?)\s*::\s*(.+)$/);
        if (!m) continue;
        const ids = m[2]
          .split(/[,\s]+/)
          .map((s) => s.trim().replace(/[^\w-]/g, ""))
          .filter((id) => byId.has(id) && !used.has(id));
        if (!ids.length) continue;
        ids.forEach((id) => used.add(id));
        grouped.push({
          title: m[1].replace(/[#*`]/g, "").slice(0, 110),
          sources: ids.map((id) => byId.get(id)!),
        });
      }
      for (const it of data.items) {
        if (!used.has(it.id)) grouped.push({ title: it.title, sources: [it] });
      }
      if (grouped.length) units = grouped;
    } catch (e) {
      skipped.push({
        title: "Topic grouping",
        reason: `clustering failed, fell back to one article per item (${
          e instanceof Error ? e.message : "unknown error"
        })`,
      });
    }
  }

  units = units.slice(0, MAX_ARTICLES);
  const articles: IngestedArticle[] = [];

  for (const unit of units) {
    const sourceNames = unit.sources.map((s) => s.title);
    try {
      let budget = MAX_GROUP_CHARS;
      const blocks: string[] = [];
      for (const s of unit.sources) {
        const share = Math.max(
          1_000,
          Math.floor(MAX_GROUP_CHARS / unit.sources.length),
        );
        const body = s.text.slice(0, Math.min(share, budget));
        if (!body) break;
        budget -= body.length;
        blocks.push(`### Source: ${s.title} (${s.kind})\n${body}`);
      }

      const md = await ask(
        "You write concise, reusable knowledge-base articles for a farm operations app. " +
          ARTICLE_SHAPE,
        `Suggested topic: ${unit.title}\n\n${blocks.join("\n\n")}`,
      );
      if (!md || md.length < 40) throw new Error("model returned an empty article");

      const rawName = firstHeading(md) ?? unit.title;
      const wanted =
        rawName.replace(/[\/\\<>:"|?*\x00-\x1f]/g, "-").trim() || "Untitled";
      let name = wanted;
      let n = 2;
      while (taken.has(name)) name = `${wanted} (${n++})`;
      taken.add(name);

      const body = tidyProcedure(name, markdownToTinyWiki(md)).body;
      const html = buildTinyWikiHtml(name, body);
      const { error } = await context.supabase
        .from("procedures")
        .upsert(
          { user_id: context.userId, name, content: html },
          { onConflict: "user_id,name" },
        );
      if (error) throw new Error(error.message);

      articles.push({
        name,
        status: name === wanted ? "saved" : "renamed",
        sources: sourceNames,
        chars: body.length,
      });
    } catch (e) {
      articles.push({
        name: unit.title,
        status: "failed",
        sources: sourceNames,
        chars: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return {
    articles,
    skipped,
    model: modelId,
    escalation,
    mode: data.mode,
    latencyMs: Date.now() - started,
  };
}
