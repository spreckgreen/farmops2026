// Read-only data collection for the electrician's field workbook.
//
// Reads only. It never writes an electrical record and never touches the
// canonical PremoFarmElectrical.ods workbook.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAddon } from "@/lib/addons.server";
import { ENTITY_KINDS } from "@/lib/electrical-entities";
import { COLLECTION_FOR_KIND } from "@/lib/electrical-snapshot";
import { collectSnapshot } from "@/lib/electrical-snapshot.functions";
import type { ElectricalEntityKind } from "@/lib/electrical";
import type { WorkbookRow } from "@/lib/electrical-workbook";

type LooseDb = {
  from: (table: string) => {
    select: (columns: string) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
};

export interface WorkbookData {
  generatedAt: string;
  entities: Partial<Record<ElectricalEntityKind, WorkbookRow[]>>;
  services: { services: WorkbookRow[]; configs: WorkbookRow[]; interties: WorkbookRow[] };
  standards: WorkbookRow[];
}

async function read(db: LooseDb, table: string): Promise<WorkbookRow[]> {
  const { data, error } = await db.from(table).select("*");
  if (error) throw new Error(error.message);
  return (data ?? []) as WorkbookRow[];
}

export const electricalWorkbookData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WorkbookData> => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const db = context.supabase as unknown as LooseDb;

    const snapshot = await collectSnapshot(context.supabase);
    const entities: Partial<Record<ElectricalEntityKind, WorkbookRow[]>> = {};
    for (const kind of ENTITY_KINDS) {
      const collection = COLLECTION_FOR_KIND[kind];
      entities[kind] = (snapshot[collection] ?? []) as unknown as WorkbookRow[];
    }

    const [services, configs, interties, standards] = await Promise.all([
      read(db, "electrical_services"),
      read(db, "electrical_service_configurations"),
      read(db, "electrical_interties"),
      read(db, "electrical_naming_standards"),
    ]);

    return {
      generatedAt: snapshot.generated_at,
      entities,
      services: { services, configs, interties },
      standards,
    };
  });
