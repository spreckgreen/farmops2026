// Resolve the audited PNL-FS-NW load links from APPROVED records.
//
// Read-only: this reads the applied breaker positions, their circuit groups and
// the existing loads, then returns a links-only manifest for import. It writes
// nothing; the returned manifest still has to be imported, previewed and
// approved item by item before any load link is set.
import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import {
  FS_NW_AUDITED_BREAKERS,
  FS_NW_AUDITED_LOADS,
  FS_NW_PANEL_ID,
  buildFsNwLoadLinkManifest,
  type LinkManifestResult,
  type ResolvedAuditedGroup,
} from "@/lib/electrical-fs-nw-audit-r1";

type LooseDb = { from: (table: string) => any };
type Row = Record<string, unknown>;

const str = (v: unknown) => (v == null ? "" : String(v)).trim();
const side = (v: unknown) => {
  const s = str(v).toLowerCase();
  if (s.startsWith("l") || s === "a" || s === "1") return "Left";
  if (s.startsWith("r") || s === "b" || s === "2") return "Right";
  return "";
};

export interface FsNwLinkResolution
  extends Omit<LinkManifestResult, "manifest"> {
  manifest_text: string;
  panel_found: boolean;
  resolvedGroups: ResolvedAuditedGroup[];
  /** Audited load IDs seen in FarmOps. */
  loadsFound: string[];
}

/**
 * Build the follow-up links batch from whatever is already approved and
 * applied. Breaker identity is panel + physical position; the circuit group is
 * read through `electrical_breaker_positions.circuit_group_uuid`, so the link
 * items always carry the real permanent CG-FS-### identity.
 */
export const resolveFsNwAuditedLoadLinks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FsNwLinkResolution> => {
    await requireElectricalAccess(context.supabase, context.userId, "read");
    const db = context.supabase as unknown as LooseDb;

    const panel = await db
      .from("electrical_panels")
      .select("id,panel_id")
      .eq("panel_id", FS_NW_PANEL_ID)
      .maybeSingle();
    if (panel.error) throw new Error(panel.error.message);
    const panelRow = (panel.data ?? null) as Row | null;

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

    const loads = await db
      .from("electrical_loads")
      .select("load_id,circuit_group_uuid")
      .in("load_id", auditedIds);
    if (loads.error) throw new Error(loads.error.message);
    const loadRows = (loads.data ?? []) as Row[];
    const knownLoadIds = loadRows.map((r) => str(r["load_id"]).toUpperCase());

    // A load already pointing at its audited group needs no write.
    const uuidByGroupId = new Map(groups.map((g) => [g.circuit_group_id, g]));
    const groupUuidLookup = new Map<string, string>();
    if (uuidByGroupId.size) {
      const g = await db
        .from("electrical_circuit_groups")
        .select("id,circuit_group_id")
        .in("circuit_group_id", Array.from(uuidByGroupId.keys()));
      if (g.error) throw new Error(g.error.message);
      for (const row of (g.data ?? []) as Row[]) {
        groupUuidLookup.set(str(row["circuit_group_id"]), String(row["id"]));
      }
    }
    const expectedUuidByLoad = new Map<string, string>();
    for (const b of FS_NW_AUDITED_BREAKERS) {
      const group = groups.find((x) => x.breaker_reference === b.breaker_reference);
      if (!group) continue;
      const uuid = groupUuidLookup.get(group.circuit_group_id);
      if (!uuid) continue;
      for (const id of FS_NW_AUDITED_LOADS[b.breaker_reference] ?? []) {
        expectedUuidByLoad.set(id.toUpperCase(), uuid);
      }
    }
    const alreadyLinked = loadRows
      .filter((r) => {
        const id = str(r["load_id"]).toUpperCase();
        const current = str(r["circuit_group_uuid"]);
        return current !== "" && current === expectedUuidByLoad.get(id);
      })
      .map((r) => str(r["load_id"]).toUpperCase());

    const built = buildFsNwLoadLinkManifest({ groups, knownLoadIds, alreadyLinked });
    const { manifest, ...rest } = built;
    return {
      ...rest,
      manifest_text: JSON.stringify(manifest, null, 2),
      panel_found: Boolean(panelRow),
      resolvedGroups: groups,
      loadsFound: knownLoadIds.sort(),
    };
  });
