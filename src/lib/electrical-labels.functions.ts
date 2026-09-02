// Read-only server function backing the printable label sheets. It only reads
// the few columns a label carries, for the kinds the print job asked for.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import { ENTITIES } from "@/lib/electrical-entities";
import {
  LABEL_KINDS,
  labelColumns,
  type LabelKind,
  type LabelRecord,
} from "@/lib/electrical-labels";

const kindSchema = z.enum(LABEL_KINDS as [LabelKind, ...LabelKind[]]);

async function readerClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as { from: (table: string) => any };
}

function text(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v).trim();
}

/**
 * Every label-printable record for the requested kinds. Loads and devices also
 * carry the panel of their linked circuit group so the print order can group by
 * panel without guessing.
 */
export const listElectricalLabels = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ kinds: z.array(kindSchema).min(1).max(10) }).parse(d))
  .handler(async ({ context, data }): Promise<LabelRecord[]> => {
    await requireElectricalAccess(context.supabase, context.userId, "read");
    const db = await readerClient();
    const kinds = [...new Set(data.kinds)];

    // Circuit group → panel, only when a kind actually needs it.
    let groupPanel = new Map<string, string>();
    if (kinds.includes("load") || kinds.includes("device")) {
      const { data: groups } = await db
        .from("electrical_circuit_groups")
        .select("id, suggested_panel");
      groupPanel = new Map(
        ((groups ?? []) as Record<string, unknown>[]).map((g) => [
          String(g["id"]),
          text(g["suggested_panel"]),
        ]),
      );
    }

    const out: LabelRecord[] = [];
    for (const kind of kinds) {
      const def = ENTITIES[kind];
      const columns = labelColumns(kind);
      const { data: rows, error } = await db.from(def.table).select(columns.join(", "));
      if (error) throw new Error(`${def.title}: ${error.message}`);
      for (const raw of (rows ?? []) as Record<string, unknown>[]) {
        const values: Record<string, string> = {};
        for (const col of columns) {
          if (col === "id") continue;
          const v = text(raw[col]);
          if (v) values[col] = v;
        }
        const linked = text(raw["circuit_group_uuid"]);
        if (linked && groupPanel.get(linked)) values["circuit_group_panel"] = groupPanel.get(linked)!;
        out.push({
          id: String(raw["id"]),
          kind,
          stable_id: text(raw[def.stableIdField]) || "(no ID)",
          values,
        });
      }
    }
    return out;
  });
