// Resolve FA-FS-2026-09-03-PM-R3 from APPROVED records.
//
// Read-only: it reads the applied PNL-FS-NW breaker positions, their permanent
// circuit groups, the panel's building and the audited loads, then returns the
// metadata-reconciliation manifest for import. It writes nothing — every item
// still needs individual owner approval before anything is applied.
import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import {
  FS_NW_AUDITED_BREAKERS,
  FS_NW_AUDITED_LOADS,
  FS_NW_PANEL_ID,
  type ResolvedAuditedGroup,
} from "@/lib/electrical-fs-nw-audit-r1";
import { buildFsNwAuditManifestR3 } from "@/lib/electrical-fs-nw-audit-r3";

type LooseDb = { from: (table: string) => any };
type Row = Record<string, unknown>;

const str = (v: unknown) => (v == null ? "" : String(v)).trim();
const side = (v: unknown) => {
  const s = str(v).toLowerCase();
  if (s.startsWith("l") || s === "a" || s === "1") return "Left";
  if (s.startsWith("r") || s === "b" || s === "2") return "Right";
  return "";
};

export interface FsNwR3Resolution {
  manifest_text: string;
  panel_found: boolean;
  building_from_panel: string | null;
  resolvedGroups: ResolvedAuditedGroup[];
  reconciled: string[];
  groupsNotApproved: string[];
  loadsNotFound: string[];
  sharedCircuitLoads: string[];
  dedicatedCircuitLoads: string[];
  gapCount: number;
}

export const resolveFsNwAsBuiltReconciliation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FsNwR3Resolution> => {
    await requireElectricalAccess(context.supabase, context.userId, "read");
    const db = context.supabase as unknown as LooseDb;

    const panel = await db
      .from("electrical_panels")
      .select("id,panel_id,building")
      .eq("panel_id", FS_NW_PANEL_ID)
      .maybeSingle();
    if (panel.error) throw new Error(panel.error.message);
    const panelRow = (panel.data ?? null) as Row | null;
    // Building context comes from the panel record only — the authoritative
    // relationship chain — never from a stable-ID prefix.
    const building = panelRow ? str(panelRow["building"]) || null : null;

    let groups: ResolvedAuditedGroup[] = [];
    if (panelRow) {
      const [positions, groupRows] = await Promise.all([
        db
          .from("electrical_breaker_positions")
          .select("id,side,position,breaker_number,circuit_group_uuid")
          .eq("panel_uuid", String(panelRow["id"])),
        db.from("electrical_circuit_groups").select("id,circuit_group_id"),
      ]);
      for (const r of [positions, groupRows]) if (r.error) throw new Error(r.error.message);
      const groupIdByUuid = new Map(
        ((groupRows.data ?? []) as Row[]).map((g) => [String(g["id"]), str(g["circuit_group_id"])]),
      );
      const posRows = (positions.data ?? []) as Row[];
      groups = FS_NW_AUDITED_BREAKERS.flatMap((b) => {
        const match = posRows.find(
          (p) =>
            side(p["side"]) === b.side &&
            Number(p["position"]) === b.position &&
            str(p["circuit_group_uuid"]) !== "",
        );
        const groupId = match ? groupIdByUuid.get(str(match["circuit_group_uuid"])) : undefined;
        if (!groupId) return [];
        return [{ breaker_reference: b.breaker_reference, circuit_group_id: groupId }];
      });
    }

    const auditedIds = Array.from(
      new Set(Object.values(FS_NW_AUDITED_LOADS).flat().map((v) => v.toUpperCase())),
    ).sort();

    const loads = await db.from("electrical_loads").select("load_id").in("load_id", auditedIds);
    if (loads.error) throw new Error(loads.error.message);
    const knownLoadIds = ((loads.data ?? []) as Row[]).map((r) => str(r["load_id"]).toUpperCase());

    const built = buildFsNwAuditManifestR3({
      groups,
      knownLoadIds,
      buildingFromPanel: building,
    });

    return {
      manifest_text: JSON.stringify(built.manifest, null, 2),
      panel_found: Boolean(panelRow),
      building_from_panel: building,
      resolvedGroups: groups,
      reconciled: built.reconciled,
      groupsNotApproved: built.groupsNotApproved,
      loadsNotFound: built.loadsNotFound,
      sharedCircuitLoads: built.sharedCircuitLoads,
      dedicatedCircuitLoads: built.dedicatedCircuitLoads,
      gapCount: built.gapCount,
    };
  });
