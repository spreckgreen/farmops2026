// Server functions backing the Procedure ↔ Inventory/Maintenance link manager.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildTinyWikiHtml } from "@/lib/tinywiki";
import {
  composeBodyWithLinks,
  extractBodyFromHtml,
  type ManagedLink,
} from "@/lib/procedure-link-section";

export type LinkTargetKind = "inventory" | "maintenance";


export interface ProcedureLinkRow {
  id: string;
  procedure_id: string;
  procedure_name: string;
  kind: LinkTargetKind;
  target_id: string;
  target_label: string;
  notes: string | null;
  created_at: string;
  /** True when this link points at a part/consumable (or an item type that can
   *  no longer hold a manual). The link still works — it is flagged so it can be
   *  relinked to equipment or ham radio gear instead of silently breaking. */
  needs_relink?: boolean;
  relink_reason?: string | null;
  target_item_type?: string | null;
}

export interface LinkTargetOption {
  id: string;
  label: string;
  itemType?: string | null;
  manualEligible?: boolean;
}

async function resolveProcedureId(
  supabase: { from: (t: string) => { select: (c: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: { id: string } | null; error: { message: string } | null }> } } } } },
  userId: string,
  name: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("procedures")
    .select("id")
    .eq("user_id", userId)
    .eq("name", name)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Procedure "${name}" not found`);
  return data.id;
}

/** Fetch current links for a procedure and rebuild its body so the managed
 *  "Linked Items" section reflects them. Safe no-op if the row is missing. */
type SupabaseLike = {
  from: (t: string) => {
    select: (c: string) => unknown;
    update: (v: Record<string, unknown>) => {
      eq: (c: string, v: string) => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> };
    };
  };
};

async function syncProcedureBodyLinks(
  supabase: unknown,
  userId: string,
  procedureName: string,
  procedureId: string,
): Promise<void> {
  const sb = supabase as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (c: string, v: string) => {
          eq: (c: string, v: string) => {
            maybeSingle: () => Promise<{ data: { content: string } | null; error: { message: string } | null }>;
            order?: (c: string, o: { ascending: boolean }) => Promise<{
              data: Array<{
                inventory_item_id: string | null;
                maintenance_record_id: string | null;
                notes: string | null;
                inventory_items: { name: string | null; sku: string | null } | null;
                maintenance_records: { title: string | null; asset_name: string | null; service_type: string | null; performed_at: string | null } | null;
              }> | null;
              error: { message: string } | null;
            }>;
          };
        };
      };
      update: (v: Record<string, unknown>) => {
        eq: (c: string, v: string) => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> };
      };
    };
  };

  const procQ = await sb
    .from("procedures")
    .select("content")
    .eq("user_id", userId)
    .eq("name", procedureName)
    .maybeSingle();
  if (procQ.error || !procQ.data) return;

  const linksQ = await sb
    .from("procedure_links")
    .select(
      "inventory_item_id, maintenance_record_id, notes, " +
        "inventory_items(name, sku), maintenance_records(title, asset_name, service_type, performed_at)",
    )
    .eq("user_id", userId)
    .eq("procedure_id", procedureId)
    .order!("created_at", { ascending: true });
  if (linksQ.error) return;

  const managed: ManagedLink[] = (linksQ.data ?? []).map((r) => {
    if (r.inventory_item_id) {
      const inv = r.inventory_items;
      return {
        id: r.inventory_item_id,
        kind: "inventory" as const,
        label: [inv?.name || "(unnamed)", inv?.sku].filter(Boolean).join(" · "),
        notes: r.notes,
      };
    }
    const m = r.maintenance_records;
    return {
      id: r.maintenance_record_id ?? "",
      kind: "maintenance" as const,
      label: [m?.title || m?.service_type || "Maintenance", m?.asset_name, m?.performed_at]
        .filter(Boolean)
        .join(" · "),
      notes: r.notes,
    };
  });

  const prevBody = extractBodyFromHtml(procQ.data.content || "", procedureName);
  const nextBody = composeBodyWithLinks(prevBody, managed);
  const nextHtml = buildTinyWikiHtml(procedureName, nextBody);
  const sbUp = supabase as SupabaseLike;
  await sbUp
    .from("procedures")
    .update({ content: nextHtml })
    .eq("user_id", userId)
    .eq("name", procedureName);
}

export const listProcedureLinks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { procedureName: string }) => {
    if (!d?.procedureName) throw new Error("procedureName required");
    return { procedureName: String(d.procedureName) };
  })

  .handler(async ({ context, data }): Promise<ProcedureLinkRow[]> => {
    const procId = await resolveProcedureId(
      context.supabase as unknown as Parameters<typeof resolveProcedureId>[0],
      context.userId,
      data.procedureName,
    );
    const { data: rows, error } = await context.supabase
      .from("procedure_links")
      .select(
        "id, procedure_id, inventory_item_id, maintenance_record_id, notes, created_at, " +
          "inventory_items(name, sku), maintenance_records(title, asset_name, service_type, performed_at)",
      )
      .eq("user_id", context.userId)
      .eq("procedure_id", procId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    type Row = {
      id: string;
      procedure_id: string;
      inventory_item_id: string | null;
      maintenance_record_id: string | null;
      notes: string | null;
      created_at: string;
      inventory_items: { name: string | null; sku: string | null } | null;
      maintenance_records: {
        title: string | null;
        asset_name: string | null;
        service_type: string | null;
        performed_at: string | null;
      } | null;
    };
    return ((rows ?? []) as unknown as Row[]).map((r): ProcedureLinkRow => {
      if (r.inventory_item_id) {
        const inv = r.inventory_items;
        const label = [inv?.name, inv?.sku].filter(Boolean).join(" · ") || r.inventory_item_id;
        return {
          id: r.id,
          procedure_id: r.procedure_id,
          procedure_name: data.procedureName,
          kind: "inventory",
          target_id: r.inventory_item_id,
          target_label: label,
          notes: r.notes,
          created_at: r.created_at,
        };
      }
      const m = r.maintenance_records;
      const label =
        [m?.title || m?.service_type || "Maintenance", m?.asset_name, m?.performed_at]
          .filter(Boolean)
          .join(" · ") || (r.maintenance_record_id ?? "");
      return {
        id: r.id,
        procedure_id: r.procedure_id,
        procedure_name: data.procedureName,
        kind: "maintenance",
        target_id: r.maintenance_record_id ?? "",
        target_label: label,
        notes: r.notes,
        created_at: r.created_at,
      };
    });
  });

export const createProcedureLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { procedureName: string; kind: LinkTargetKind; targetId: string; notes?: string }) => {
    if (!d?.procedureName) throw new Error("procedureName required");
    if (d?.kind !== "inventory" && d?.kind !== "maintenance") throw new Error("kind invalid");
    if (!d?.targetId) throw new Error("targetId required");
    return {
      procedureName: String(d.procedureName),
      kind: d.kind,
      targetId: String(d.targetId),
      notes: d.notes ? String(d.notes) : null,
    };
  })
  .handler(async ({ context, data }) => {
    const procId = await resolveProcedureId(
      context.supabase as unknown as Parameters<typeof resolveProcedureId>[0],
      context.userId,
      data.procedureName,
    );
    const payload = {
      user_id: context.userId,
      procedure_id: procId,
      notes: data.notes,
      inventory_item_id: data.kind === "inventory" ? data.targetId : null,
      maintenance_record_id: data.kind === "maintenance" ? data.targetId : null,
    };
    const { error } = await context.supabase.from("procedure_links").insert(payload);
    if (error) {
      if (/duplicate|unique/i.test(error.message)) throw new Error("This procedure is already linked to that item.");
      throw new Error(error.message);
    }
    await syncProcedureBodyLinks(context.supabase, context.userId, data.procedureName, procId);
    return { ok: true as const };
  });


export const deleteProcedureLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => {
    if (!d?.id) throw new Error("id required");
    return { id: String(d.id) };
  })
  .handler(async ({ context, data }) => {
    // Look up the procedure first so we can resync its body after deletion.
    const { data: row } = await context.supabase
      .from("procedure_links")
      .select("procedure_id, procedures(name)")
      .eq("user_id", context.userId)
      .eq("id", data.id)
      .maybeSingle();
    const { error } = await context.supabase
      .from("procedure_links")
      .delete()
      .eq("user_id", context.userId)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    const procRow = row as { procedure_id: string; procedures: { name: string | null } | null } | null;
    if (procRow?.procedure_id && procRow.procedures?.name) {
      await syncProcedureBodyLinks(
        context.supabase,
        context.userId,
        procRow.procedures.name,
        procRow.procedure_id,
      );
    }
    return { ok: true as const };
  });


export const listLinkTargets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { kind: LinkTargetKind }) => {
    if (d?.kind !== "inventory" && d?.kind !== "maintenance") throw new Error("kind invalid");
    return { kind: d.kind };
  })
  .handler(async ({ context, data }): Promise<LinkTargetOption[]> => {
    if (data.kind === "inventory") {
      const { data: rows, error } = await context.supabase
        .from("inventory_items")
        .select("id, name, sku")
        .eq("user_id", context.userId)
        .order("name", { ascending: true })
        .limit(500);
      if (error) throw new Error(error.message);
      return ((rows ?? []) as Array<{ id: string; name: string | null; sku: string | null }>).map((r) => ({
        id: r.id,
        label: [r.name || "(unnamed)", r.sku].filter(Boolean).join(" · "),
      }));
    }
    const { data: rows, error } = await context.supabase
      .from("maintenance_records")
      .select("id, title, asset_name, service_type, performed_at")
      .eq("user_id", context.userId)
      .order("performed_at", { ascending: false, nullsFirst: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return ((rows ?? []) as Array<{
      id: string;
      title: string | null;
      asset_name: string | null;
      service_type: string | null;
      performed_at: string | null;
    }>).map((r) => ({
      id: r.id,
      label:
        [r.title || r.service_type || "Maintenance", r.asset_name, r.performed_at]
          .filter(Boolean)
          .join(" · ") || r.id,
    }));
  });
