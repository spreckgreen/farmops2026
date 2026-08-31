// Server functions for generated Mermaid diagrams. The diagram is derived on
// every request from the authoritative records, so it can never drift from the
// data the way a hand-maintained drawing would.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireAddon } from "@/lib/addons.server";
import { ENTITIES } from "@/lib/electrical-entities";
import type { ElectricalEntityKind } from "@/lib/electrical";
import {
  buildDiagram,
  DIAGRAM_TYPES,
  STATE_FILTERS,
  type DiagramType,
  type ElectricalGraphData,
  type GeneratedDiagram,
  type Row,
  type StateFilter,
} from "@/lib/electrical-mermaid";

type LooseDb = { from: (table: string) => any };

const filterSchema = z.object({
  type: z.enum(DIAGRAM_TYPES as unknown as [DiagramType, ...DiagramType[]]),
  state: z.enum(STATE_FILTERS as unknown as [StateFilter, ...StateFilter[]]).optional(),
  focus: z.string().trim().max(60).optional(),
  panel: z.string().trim().max(60).optional(),
  building: z.string().trim().max(80).optional(),
  grid: z.string().trim().max(40).optional(),
  circuitGroup: z.string().trim().max(60).optional(),
  environment: z.string().trim().max(40).optional(),
});

export interface DiagramPayload extends GeneratedDiagram {
  /** Choices for the filter controls, derived from the current records. */
  options: {
    panels: string[];
    buildings: string[];
    grids: string[];
    circuitGroups: string[];
    raceways: string[];
    jboxes: string[];
    environments: string[];
    racks: string[];
    powerAssets: string[];
  };
}

export const generateElectricalDiagram = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => filterSchema.parse(d))
  .handler(async ({ context, data }): Promise<DiagramPayload> => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const db = context.supabase as unknown as LooseDb;

    const kinds: ElectricalEntityKind[] = [
      "panel",
      "circuit_group",
      "load",
      "raceway",
      "jbox",
      "branch",
      "rack",
      "power_asset",
      "device",
    ];
    const fetched = await Promise.all(
      kinds.map(async (kind) => {
        const { data: rows, error } = await db
          .from(ENTITIES[kind].table)
          .select("*")
          .order(ENTITIES[kind].stableIdField);
        if (error) throw new Error(error.message);
        return (rows ?? []) as Row[];
      }),
    );
    const { data: waypoints } = await db
      .from("electrical_raceway_waypoints")
      .select("*")
      .order("sequence");

    // Service identities + their revisions are the authoritative source of
    // service-to-panel relationships in the generated topology.
    const serviceTables = [
      "electrical_services",
      "electrical_service_configurations",
      "electrical_service_panels",
      "electrical_interties",
      "electrical_intertie_configurations",
    ] as const;
    const serviceRows = await Promise.all(
      serviceTables.map(async (table) => {
        const { data: rows } = await db.from(table).select("*");
        return (rows ?? []) as Row[];
      }),
    );

    const graph: ElectricalGraphData = {
      panel: fetched[0],
      circuit_group: fetched[1],
      load: fetched[2],
      raceway: fetched[3],
      jbox: fetched[4],
      branch: fetched[5],
      rack: fetched[6],
      power_asset: fetched[7],
      device: fetched[8],
      waypoint: (waypoints ?? []) as Row[],
      service: serviceRows[0],
      service_config: serviceRows[1],
      service_panel: serviceRows[2],
      intertie: serviceRows[3],
      intertie_config: serviceRows[4],
    };

    const uniq = (values: (string | null | undefined)[]) =>
      [...new Set(values.map((v) => String(v ?? "").trim()).filter(Boolean))].sort();

    const options: DiagramPayload["options"] = {
      panels: uniq(graph.panel.map((p) => p["panel_id"] as string)),
      buildings: uniq([
        ...graph.panel.map((p) => p["building"] as string),
        ...graph.jbox.map((j) => j["building"] as string),
        ...graph.raceway.map((r) => r["source_building"] as string),
        ...graph.raceway.map((r) => r["dest_building"] as string),
      ]),
      grids: uniq([
        ...graph.panel.map((p) => p["grid"] as string),
        ...graph.jbox.map((j) => j["grid"] as string),
        ...graph.load.map((l) => l["grid"] as string),
      ]),
      circuitGroups: uniq(graph.circuit_group.map((g) => g["circuit_group_id"] as string)),
      raceways: uniq(graph.raceway.map((r) => r["conduit_id"] as string)),
      jboxes: uniq(graph.jbox.map((j) => j["jbox_id"] as string)),
      environments: uniq(graph.raceway.map((r) => r["environment"] as string)),
      racks: uniq((graph.rack ?? []).map((r) => r["rack_id"] as string)),
      powerAssets: uniq((graph.power_asset ?? []).map((r) => r["power_asset_id"] as string)),
    };

    return { ...buildDiagram(graph, data), options };
  });
