// Phase 4.3 server functions: panel breaker positions and panel raceway exits.
// Thin wrappers only — every rule lives in electrical-panel-layout.ts.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAddon } from "@/lib/addons.server";
import { PANEL_EXIT_SIDES, INSTALL_STATUSES } from "@/lib/electrical";
import {
  BREAKER_SIDES,
  validatePanelLayout,
  type PanelLayoutFinding,
} from "@/lib/electrical-panel-layout";

type LooseDb = { from: (table: string) => any };
type Row = Record<string, string | number | boolean | null>;

const BREAKER_TABLE = "electrical_breaker_positions";
const EXIT_TABLE = "electrical_panel_exits";

const nullableUuid = z.string().uuid().nullable().optional();
const status = z.enum(INSTALL_STATUSES as unknown as [string, ...string[]]).nullable().optional();

/** Both child collections for one panel, plus that panel's own row. */
export const panelLayout = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ panel_uuid: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const db = context.supabase as unknown as LooseDb;
    const [panel, positions, exits, raceways] = await Promise.all([
      db.from("electrical_panels").select("*").eq("id", data.panel_uuid).maybeSingle(),
      db.from(BREAKER_TABLE).select("*").eq("panel_uuid", data.panel_uuid).order("position"),
      db.from(EXIT_TABLE).select("*").eq("panel_uuid", data.panel_uuid).order("exit_order"),
      db
        .from("electrical_raceways")
        .select("id,conduit_id,source_panel_uuid,dest_panel_uuid,trade_size"),
    ]);
    for (const r of [panel, positions, exits, raceways]) {
      if (r.error) throw new Error(r.error.message);
    }
    const panelRow = (panel.data ?? null) as Row | null;
    const positionRows = (positions.data ?? []) as Row[];
    const exitRows = (exits.data ?? []) as Row[];
    const racewayRows = (raceways.data ?? []) as Row[];
    const findings: PanelLayoutFinding[] = panelRow
      ? validatePanelLayout({
          panels: [panelRow],
          positions: positionRows,
          exits: exitRows,
          raceways: racewayRows,
        })
      : [];
    return {
      panel: panelRow,
      positions: positionRows,
      exits: exitRows,
      raceways: racewayRows,
      findings,
    };
  });

export const saveBreakerPosition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        panel_uuid: z.string().uuid(),
        side: z.enum(BREAKER_SIDES as unknown as [string, ...string[]]),
        position: z.number().int().min(1).max(200),
        breaker_number: z.number().int().min(1).max(400).nullable().optional(),
        poles: z.number().int().min(1).max(4).default(1),
        circuit_group_uuid: nullableUuid,
        load_uuid: nullableUuid,
        label: z.string().trim().max(160).nullable().optional(),
        ocp_amps: z.number().min(0).max(10000).nullable().optional(),
        install_status: status,
        notes: z.string().trim().max(2000).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const db = context.supabase as unknown as LooseDb;
    const { id, ...values } = data;
    const row = {
      ...values,
      circuit_group_uuid: values.circuit_group_uuid ?? null,
      load_uuid: values.load_uuid ?? null,
      breaker_number: values.breaker_number ?? null,
      ocp_amps: values.ocp_amps ?? null,
      label: values.label || null,
      notes: values.notes || null,
      install_status: values.install_status ?? null,
    };
    const res = id
      ? await db.from(BREAKER_TABLE).update(row).eq("id", id)
      : await db.from(BREAKER_TABLE).insert({ ...row, user_id: context.userId });
    if (res.error) {
      const message = /duplicate key|slot_key/i.test(res.error.message)
        ? `${row.side} ${row.position} is already recorded for this panel — one physical slot holds one record.`
        : res.error.message;
      throw new Error(message);
    }
    return { ok: true };
  });

export const savePanelExit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        panel_uuid: z.string().uuid(),
        raceway_uuid: nullableUuid,
        exit_order: z.number().int().min(1).max(200),
        exit_side: z
          .enum(PANEL_EXIT_SIDES as unknown as [string, ...string[]])
          .nullable()
          .optional(),
        trade_size: z.string().trim().max(40).nullable().optional(),
        raceway_ref: z.string().trim().max(80).nullable().optional(),
        install_status: status,
        notes: z.string().trim().max(2000).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const db = context.supabase as unknown as LooseDb;
    const { id, ...values } = data;
    const row = {
      ...values,
      raceway_uuid: values.raceway_uuid ?? null,
      exit_side: values.exit_side ?? null,
      trade_size: values.trade_size || null,
      raceway_ref: values.raceway_ref || null,
      install_status: values.install_status ?? null,
      notes: values.notes || null,
    };
    const res = id
      ? await db.from(EXIT_TABLE).update(row).eq("id", id)
      : await db.from(EXIT_TABLE).insert({ ...row, user_id: context.userId });
    if (res.error) {
      const message = /duplicate key|order_key/i.test(res.error.message)
        ? `Exit order ${row.exit_order} is already used on this panel — physical exit order is unique per panel.`
        : res.error.message;
      throw new Error(message);
    }
    return { ok: true };
  });

export const deletePanelLayoutRow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ table: z.enum(["breaker_position", "panel_exit"]), id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const table = data.table === "breaker_position" ? BREAKER_TABLE : EXIT_TABLE;
    const { error } = await (context.supabase as unknown as LooseDb)
      .from(table)
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
