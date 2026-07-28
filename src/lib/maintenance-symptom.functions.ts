// Symptom → procedure: free-text machine issue in, matching procedure +
// parts list + proposed maintenance record out. Uses gateway model with
// a strict Output.object schema (no field bounds; limits stated in prompt).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export interface DiagnosisPart {
  inventory_item_id: string | null;
  name: string;
  quantity: number | null;
  in_stock: boolean;
}

export interface Diagnosis {
  matchedProcedureName: string | null;
  confidence: "high" | "medium" | "low";
  reasoning: string;
  suspectedAssets: { id: string; name: string }[];
  partsFromInventory: DiagnosisPart[];
  partsMissing: { name: string; reason: string }[];
  suggestedRecord: {
    title: string;
    service_type: string;
    description: string;
  } | null;
  candidatesConsidered: string[];
  model: string;
  latencyMs: number;
}

const SymptomInput = z.object({
  text: z.string().trim().min(3).max(2000),
  assetIdHint: z.string().uuid().nullable().optional(),
});

// Strip HTML/wiki markup for a compact excerpt.
function stripToText(html: string): string {
  return String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokenize + score procedures against a query by simple keyword overlap. */
function rankCandidates(
  query: string,
  procs: { name: string; text: string }[],
): { name: string; text: string; score: number }[] {
  const q = query.toLowerCase();
  const terms = Array.from(
    new Set(q.match(/[a-z0-9]{3,}/g) ?? []),
  );
  return procs
    .map((p) => {
      const hay = `${p.name} ${p.text}`.toLowerCase();
      let score = 0;
      for (const t of terms) {
        // Word-ish boundary
        const re = new RegExp(`\\b${t.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}`, "g");
        const matches = hay.match(re);
        if (matches) score += matches.length;
      }
      return { ...p, score };
    })
    .sort((a, b) => b.score - a.score);
}

export const diagnoseSymptom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SymptomInput.parse(d))
  .handler(async ({ data, context }): Promise<Diagnosis> => {
    const { supabase, userId } = context;
    const { withIdempotency } = await import("./ai-idempotency.server");
    return withIdempotency(
      { supabase, userId, surface: "maintenance.diagnose", input: data },
      async (): Promise<Diagnosis> => {

    // Pull procedures, inventory, and assets in parallel
    const [procRes, invRes] = await Promise.all([
      supabase
        .from("procedures")
        .select("name, content")
        .eq("user_id", userId),
      supabase
        .from("inventory_items")
        .select("id, name, sku, category, quantity, unit, status, min_quantity")
        .eq("user_id", userId),
    ]);
    if (procRes.error) throw new Error(procRes.error.message);
    if (invRes.error) throw new Error(invRes.error.message);

    const procs = (procRes.data ?? []).map((r) => ({
      name: String(r.name),
      text: stripToText(String(r.content ?? "")).slice(0, 800),
    }));
    const inventory = invRes.data ?? [];

    // Rank top ~15 candidate procedures
    const ranked = rankCandidates(data.text, procs).slice(0, 15);
    const candidates = ranked.filter((p) => p.score > 0);
    const candidatePool = candidates.length > 0 ? candidates : ranked;

    // Compact inventory summary (name + qty)
    const inventorySummary = inventory
      .slice(0, 200)
      .map((i) => {
        const qty = i.quantity != null ? Number(i.quantity) : 0;
        const min = i.min_quantity != null ? Number(i.min_quantity) : 0;
        return `- ${i.name ?? i.sku ?? "?"} (id:${i.id}) qty=${qty}${i.unit ? " " + i.unit : ""}${min > 0 ? `, min=${min}` : ""}`;
      })
      .join("\n");

    const proceduresBlock = candidatePool
      .slice(0, 15)
      .map((p) => `### ${p.name}\n${p.text.slice(0, 400)}`)
      .join("\n\n");

    const assetsList = inventory
      .filter((i) => i.status !== "retired")
      .slice(0, 100)
      .map((i) => `- ${i.name ?? i.sku ?? "?"} (id:${i.id})`)
      .join("\n");

    const { createAiProvider } = await import("./ai-gateway.server");
    const { provider, modelOverride } = await createAiProvider();
    const modelId = modelOverride ?? "google/gemini-3.6-flash";

    const { generateText, Output, NoObjectGeneratedError } = await import("ai");

    // Constraint-free schema; length/count limits go in the prompt.
    const schema = z.object({
      matchedProcedureName: z.string().nullable(),
      confidence: z.enum(["high", "medium", "low"]),
      reasoning: z.string(),
      suspectedAssetIds: z.array(z.string()),
      partsFromInventory: z.array(
        z.object({
          inventory_item_id: z.string().nullable(),
          name: z.string(),
          quantity: z.number().nullable(),
        }),
      ),
      partsMissing: z.array(
        z.object({ name: z.string(), reason: z.string() }),
      ),
      suggestedRecord: z
        .object({
          title: z.string(),
          service_type: z.string(),
          description: z.string(),
        })
        .nullable(),
    });

    const validNames = new Set(candidatePool.map((p) => p.name));
    const validAssetIds = new Set(inventory.map((i) => i.id));

    const started = Date.now();
    let parsed: z.infer<typeof schema> | null = null;
    try {
      const { output } = await generateText({
        model: provider(modelId),
        output: Output.object({ schema }),
        system:
          "You are a maintenance diagnostician for a small farm. Given a symptom description, " +
          "the user's existing procedures, and their inventory, return structured JSON. " +
          "Rules: (1) matchedProcedureName MUST be one of the provided procedure names, or null if none fit. " +
          "(2) Use confidence 'low' when uncertain; do not guess. " +
          "(3) suspectedAssetIds must be IDs from the assets list (max 3). " +
          "(4) partsFromInventory entries must reference inventory_item_id values shown in the inventory list. " +
          "(5) partsMissing are parts you would need but that aren't in inventory (max 5). " +
          "(6) reasoning is one short sentence.",
        prompt:
          `SYMPTOM:\n${data.text}\n\n` +
          (data.assetIdHint ? `HINTED_ASSET_ID: ${data.assetIdHint}\n\n` : "") +
          `PROCEDURES:\n${proceduresBlock || "(none)"}\n\n` +
          `INVENTORY:\n${inventorySummary || "(none)"}\n\n` +
          `ASSETS:\n${assetsList || "(none)"}`,
      });
      parsed = output;
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        // Degrade gracefully — try to salvage minimal JSON, otherwise low-confidence empty
        try {
          const text = String(error.text ?? "");
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) parsed = schema.parse(JSON.parse(jsonMatch[0]));
        } catch {
          parsed = null;
        }
      } else {
        throw error;
      }
    }

    if (!parsed) {
      return {
        matchedProcedureName: null,
        confidence: "low",
        reasoning: "Model did not return a usable diagnosis.",
        suspectedAssets: [],
        partsFromInventory: [],
        partsMissing: [],
        suggestedRecord: null,
        candidatesConsidered: candidatePool.slice(0, 15).map((p) => p.name),
        model: modelId,
        latencyMs: Date.now() - started,
      };
    }

    // Clamp / validate against real data
    const matched =
      parsed.matchedProcedureName && validNames.has(parsed.matchedProcedureName)
        ? parsed.matchedProcedureName
        : null;

    const invById = new Map(inventory.map((i) => [i.id, i]));
    const partsFromInventory: DiagnosisPart[] = parsed.partsFromInventory
      .filter((p) => p.inventory_item_id && invById.has(p.inventory_item_id))
      .slice(0, 10)
      .map((p) => {
        const inv = invById.get(p.inventory_item_id!)!;
        const stock = inv.quantity == null ? 0 : Number(inv.quantity);
        const needed = p.quantity ?? 1;
        return {
          inventory_item_id: inv.id,
          name: inv.name ?? p.name,
          quantity: needed,
          in_stock: stock >= needed,
        };
      });

    const suspectedAssets = parsed.suspectedAssetIds
      .filter((id) => validAssetIds.has(id))
      .slice(0, 3)
      .map((id) => {
        const inv = invById.get(id)!;
        return { id, name: inv.name ?? inv.sku ?? "Unnamed" };
      });

    return {
      matchedProcedureName: matched,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning.slice(0, 400),
      suspectedAssets,
      partsFromInventory,
      partsMissing: (parsed.partsMissing ?? []).slice(0, 5),
      suggestedRecord: parsed.suggestedRecord
        ? {
            title: parsed.suggestedRecord.title.slice(0, 200),
            service_type: parsed.suggestedRecord.service_type.slice(0, 100),
            description: parsed.suggestedRecord.description.slice(0, 2000),
          }
        : null,
      candidatesConsidered: candidatePool.slice(0, 15).map((p) => p.name),
      model: modelId,
      latencyMs: Date.now() - started,
    };
      },
    );
  });

const CreateFromDiagnosisInput = z.object({
  title: z.string().trim().min(1).max(200),
  service_type: z.string().trim().max(100).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  asset_id: z.string().uuid().nullable().optional(),
  asset_name: z.string().trim().max(200).nullable().optional(),
  procedure_name: z.string().trim().max(200).nullable().optional(),
});

export const createRecordFromDiagnosis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateFromDiagnosisInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: inserted, error } = await supabase
      .from("maintenance_records")
      .insert({
        user_id: userId,
        title: data.title,
        asset_id: data.asset_id ?? null,
        asset_name: data.asset_name ?? null,
        service_type: data.service_type ?? null,
        description: data.description ?? null,
        status: "scheduled",
        recurrence: "none",
        consumables_used: [] as never,
      } as never)
      .select()
      .single();
    if (error) throw new Error(error.message);

    // Optionally link the procedure
    if (data.procedure_name) {
      const { data: proc } = await supabase
        .from("procedures")
        .select("id")
        .eq("user_id", userId)
        .eq("name", data.procedure_name)
        .maybeSingle();
      if (proc?.id && inserted?.id) {
        await supabase.from("procedure_links").insert({
          user_id: userId,
          procedure_id: proc.id,
          maintenance_record_id: inserted.id,
        } as never);
      }
    }

    return inserted;
  });
