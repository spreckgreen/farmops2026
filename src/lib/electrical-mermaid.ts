// Deterministic Mermaid generation from the authoritative electrical records.
//
// Diagrams are *generated views only* — never a data source. Everything here is
// pure so the same rows always produce byte-identical Mermaid text, and so the
// validation pass (orphans, unknown panels, duplicate IDs, cycles) can be
// unit-tested without a database.

import { breakerReference } from "@/lib/electrical-breaker-reference";
import { ENTITIES } from "@/lib/electrical-entities";
import { isSiteEnvironment, type ElectricalEntityKind } from "@/lib/electrical";
import { orderedJunctionPoints, positionLabel } from "@/lib/electrical-raceway-path";
import {
  resolveServiceTopology,
  servicePanelDomainFindings,
} from "@/lib/electrical-service-topology";

export type ElectricalValue = string | number | boolean | null;
export interface Row {
  id?: string;
  [key: string]: ElectricalValue | undefined;
}

export interface ElectricalGraphData {
  panel: Row[];
  circuit_group: Row[];
  load: Row[];
  raceway: Row[];
  jbox: Row[];
  branch: Row[];
  // Feeders are panel-to-panel records; diagram views index them lazily.
  feeder?: Row[];
  waypoint?: Row[];
  // FarmOps-native infrastructure. Optional so existing callers keep compiling
  // and so the electrical views never change shape.
  rack?: Row[];
  power_asset?: Row[];
  device?: Row[];
  // Service-revision model. When present, service-to-panel relationships come
  // from the current revision instead of a synthetic utility root.
  service?: Row[];
  service_config?: Row[];
  service_panel?: Row[];
  intertie?: Row[];
  intertie_config?: Row[];
}

export const DIAGRAM_TYPES = [
  "whole_system",
  "farm_shop",
  "single_panel",
  "raceway",
  "jbox",
  "site",
  "critical_power",
  // Infrastructure views. Deliberately separate: combining power, network, rack
  // and power-dependency topology into one diagram is unreadable.
  "network",
  "rack",
  "power_dependency",
] as const;
export type DiagramType = (typeof DIAGRAM_TYPES)[number];

export const DIAGRAM_LABELS: Record<DiagramType, string> = {
  whole_system: "Whole-system topology",
  farm_shop: "Farm Shop panel topology",
  single_panel: "Single-panel wiring view",
  raceway: "Raceway topology",
  jbox: "Junction-box topology",
  site: "Site infrastructure",
  critical_power: "Critical-power topology",
  network: "Network topology",
  rack: "Rack / equipment topology",
  power_dependency: "Power dependency topology",
};

/** As-designed vs as-built comparison buckets. */
export const STATE_FILTERS = ["all", "design", "installed", "as_built"] as const;
export type StateFilter = (typeof STATE_FILTERS)[number];

export const STATE_FILTER_LABELS: Record<StateFilter, string> = {
  all: "All records",
  design: "Design / planned",
  installed: "Installed",
  as_built: "As-built verified",
};

const INSTALLED_STATUSES = new Set([
  "raceway_installed",
  "conductors_installed",
  "device_side_connected",
  "source_side_connected",
  "tested",
  "complete",
  "as_built_verified",
]);

export function matchesState(row: Row, filter: StateFilter): boolean {
  if (filter === "all") return true;
  const status = String(row["install_status"] ?? "planned");
  if (filter === "as_built") return status === "as_built_verified";
  if (filter === "installed") return INSTALLED_STATUSES.has(status);
  return !INSTALLED_STATUSES.has(status);
}

export interface DiagramFilters {
  type: DiagramType;
  state?: StateFilter;
  /** Stable ID of the focus record for single_panel / raceway / jbox views. */
  focus?: string;
  panel?: string;
  building?: string;
  grid?: string;
  circuitGroup?: string;
  /** raceway environment, e.g. SITE_UNDERGROUND */
  environment?: string;
}

export interface DiagramIssue {
  severity: "error" | "warning";
  code:
    | "orphan_branch"
    | "missing_endpoint"
    | "unknown_panel"
    | "duplicate_id"
    | "broken_topology"
    | "circular_reference"
    | "unresolved_upstream"
    | "ambiguous_service_domain";
  message: string;
}

export interface DiagramNode {
  key: string;
  stableId: string;
  kind: ElectricalEntityKind | "utility" | "unknown";
  label: string;
  /** Detail-page href when the node maps to a real FarmOps record. */
  href?: string;
  klass: string;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
  dashed?: boolean;
}

export interface GeneratedDiagram {
  mermaid: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  issues: DiagramIssue[];
}

// ------------------------------------------------------------------ utilities

function sid(kind: ElectricalEntityKind, row: Row): string {
  return String(row[ENTITIES[kind].stableIdField] ?? "").trim();
}

function s(v: ElectricalValue | undefined): string {
  return String(v ?? "").trim();
}

function truthy(v: ElectricalValue | undefined): boolean {
  return v === true || v === "true" || v === 1 || v === "1";
}

/** Mermaid node ids must be alphanumeric-ish and stable across runs. */
export function nodeKey(prefix: string, stableId: string): string {
  return `${prefix}_${stableId.replace(/[^A-Za-z0-9]+/g, "_") || "unknown"}`;
}

/** Escape text for a Mermaid quoted label. */
export function mermaidLabel(text: string): string {
  return text.replace(/["`]/g, "'").replace(/[<>]/g, "").replace(/\r?\n/g, " ").trim();
}

const SHAPES: Record<string, [string, string]> = {
  utility: ["[(", ")]"],
  intertie: ["{{", "}}"],
  panel: ["[", "]"],
  raceway: ["([", "])"],
  jbox: ["{{", "}}"],
  branch: [">", "]"],
  circuit_group: ["[/", "/]"],
  load: ["(", ")"],
  rack: ["[[", "]]"],
  power_asset: ["[/", "\\]"],
  device: ["(", ")"],
  unknown: ["[", "]"],
};

function shapeFor(kind: DiagramNode["kind"]): [string, string] {
  return SHAPES[kind] ?? SHAPES["unknown"];
}

function hrefFor(kind: DiagramNode["kind"], uuid: string | undefined): string | undefined {
  if (!uuid) return undefined;
  if (kind === "utility" || kind === "unknown") return undefined;
  return `/electrical/item/${kind}/${uuid}`;
}

function statusClass(row: Row, kind: DiagramNode["kind"]): string {
  if (truthy(row["future"]) || truthy(row["spare"])) return "future";
  if (kind === "load" || kind === "circuit_group") {
    if (truthy(row["critical"])) return "critical";
  }
  return kind;
}

// ------------------------------------------------------------------- generator

class Builder {
  nodes = new Map<string, DiagramNode>();
  edges: DiagramEdge[] = [];
  issues: DiagramIssue[] = [];

  node(
    kind: DiagramNode["kind"],
    stableId: string,
    label: string,
    row?: Row,
    klass?: string,
  ): string {
    const key = nodeKey(kind === "utility" ? "UTIL" : kind.toUpperCase().slice(0, 4), stableId);
    if (!this.nodes.has(key)) {
      this.nodes.set(key, {
        key,
        stableId,
        kind,
        label,
        href: hrefFor(kind, row?.["id"] as string | undefined),
        klass: klass ?? (row ? statusClass(row, kind) : kind),
      });
    }
    return key;
  }

  edge(from: string, to: string, label?: string, dashed?: boolean) {
    if (!from || !to) return;
    if (this.edges.some((e) => e.from === from && e.to === to && e.label === label)) return;
    this.edges.push({ from, to, ...(label ? { label } : {}), ...(dashed ? { dashed: true } : {}) });
  }

  issue(severity: DiagramIssue["severity"], code: DiagramIssue["code"], message: string) {
    if (this.issues.some((i) => i.code === code && i.message === message)) return;
    this.issues.push({ severity, code, message });
  }
}

interface Index {
  panelById: Map<string, Row>;
  jboxById: Map<string, Row>;
  loadById: Map<string, Row>;
  groupById: Map<string, Row>;
  racewayById: Map<string, Row>;
  branchById: Map<string, Row>;
}

function indexRows(data: ElectricalGraphData): Index {
  const build = (kind: ElectricalEntityKind, rows: Row[]) => {
    const m = new Map<string, Row>();
    for (const r of rows) {
      const id = sid(kind, r);
      if (id && !m.has(id)) m.set(id, r);
    }
    return m;
  };
  return {
    panelById: build("panel", data.panel),
    jboxById: build("jbox", data.jbox),
    loadById: build("load", data.load),
    groupById: build("circuit_group", data.circuit_group),
    racewayById: build("raceway", data.raceway),
    branchById: build("branch", data.branch),
  };
}

/** Duplicate stable IDs are a data error, surfaced rather than silently deduped. */
function duplicateIdIssues(data: ElectricalGraphData, b: Builder) {
  const kinds: ElectricalEntityKind[] = [
    "panel",
    "circuit_group",
    "load",
    "raceway",
    "jbox",
    "branch",
  ];
  for (const kind of kinds) {
    const seen = new Map<string, number>();
    for (const row of data[kind] ?? []) {
      const id = sid(kind, row);
      if (!id) continue;
      seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    for (const [id, count] of seen) {
      if (count > 1) {
        b.issue(
          "error",
          "duplicate_id",
          `Duplicate stable ID ${id} appears ${count} times in ${ENTITIES[kind].title}.`,
        );
      }
    }
  }
}

function endpointNode(b: Builder, idx: Index, ref: string, context: string): string | null {
  if (!ref) return null;
  const panel = idx.panelById.get(ref);
  if (panel) return b.node("panel", ref, panelLabel(panel), panel);
  const jbox = idx.jboxById.get(ref);
  if (jbox) return b.node("jbox", ref, `${ref}<br/>${s(jbox["box_type"]) || "J-box"}`, jbox);
  const load = idx.loadById.get(ref);
  if (load) return b.node("load", ref, `${ref}<br/>${s(load["description"])}`, load);
  if (ref.toUpperCase().startsWith("PNL-")) {
    b.issue("error", "unknown_panel", `${context} references unknown panel ${ref}.`);
  } else {
    b.issue("warning", "broken_topology", `${context} references unknown record ${ref}.`);
  }
  return b.node("unknown", ref, `${ref}<br/>(unknown)`, undefined, "unknown");
}

function panelLabel(panel: Row): string {
  const parts = [s(panel["panel_id"])];
  const desc = s(panel["description"]);
  if (desc) parts.push(desc);
  const rating = s(panel["bus_rating_amps"]);
  if (rating) parts.push(`${rating}A`);
  return parts.join("<br/>");
}

function racewayLabel(r: Row): string {
  const parts = [s(r["conduit_id"])];
  const size = s(r["trade_size"]);
  const type = s(r["raceway_type"]);
  const spec = [size, type].filter(Boolean).join(" ");
  if (spec) parts.push(spec);
  return parts.join("<br/>");
}

function branchLabel(r: Row): string {
  const parts = [s(r["branch_id"])];
  const spec = [s(r["conductor_size"]), s(r["wiring_method"])].filter(Boolean).join(" ");
  if (spec) parts.push(spec);
  return parts.join("<br/>");
}

function passesCommonFilters(row: Row, f: DiagramFilters): boolean {
  if (!matchesState(row, f.state ?? "all")) return false;
  if (f.building) {
    const b = f.building.toLowerCase();
    const fields = ["building", "source_building", "dest_building", "area", "location"];
    if (!fields.some((k) => s(row[k]).toLowerCase() === b)) return false;
  }
  if (f.grid) {
    const g = f.grid.toUpperCase();
    const fields = ["grid", "source_grid", "dest_grid"];
    if (!fields.some((k) => s(row[k]).toUpperCase() === g)) return false;
  }
  return true;
}

/**
 * Build the topology graph: utility -> panel -> raceway -> j-box -> branch ->
 * circuit group / load, filtered per the requested diagram type.
 */
export function buildDiagram(
  data: ElectricalGraphData,
  filters: DiagramFilters,
): GeneratedDiagram {
  if (INFRASTRUCTURE_TYPES.has(filters.type)) {
    return buildInfrastructureDiagram(data, filters);
  }
  const b = new Builder();
  const idx = indexRows(data);
  duplicateIdIssues(data, b);

  const state = filters.state ?? "all";
  const type = filters.type;
  const focus = (filters.focus ?? "").trim();

  const farmShopPanels = new Set(
    [...idx.panelById.keys()].filter((id) => id.toUpperCase().startsWith("PNL-FS")),
  );

  // ---- which panels are in scope
  let panels = data.panel.filter((p) => passesCommonFilters(p, filters));
  if (filters.panel) panels = panels.filter((p) => sid("panel", p) === filters.panel);
  if (type === "farm_shop") panels = panels.filter((p) => farmShopPanels.has(sid("panel", p)));
  if (type === "single_panel" && focus) panels = panels.filter((p) => sid("panel", p) === focus);
  if (type === "critical_power") {
    panels = panels.filter(
      (p) =>
        s(p["backup_class"]) !== "" ||
        sid("panel", p).toUpperCase().includes("CRIT") ||
        s(p["panel_id"]).toUpperCase().includes("GEN"),
    );
  }

  const panelIds = new Set(panels.map((p) => sid("panel", p)));

  // ---- utility / service + feeders
  if (panels.length && (type === "whole_system" || type === "site" || type === "critical_power")) {
    // Authoritative service-to-panel relationships come from the current
    // service revision (one resolver, shared with Electrical → Services).
    const service = resolveServiceTopology({
      panels: data.panel,
      services: data.service,
      serviceConfigs: data.service_config,
      servicePanels: data.service_panel,
      interties: data.intertie,
      intertieConfigs: data.intertie_config,
    });
    const modelled = service.services.length > 0;
    const serviceKeys = new Map<string, string>();
    if (modelled) {
      for (const svc of service.services) {
        const label = svc.ampacityAmps
          ? `${svc.serviceId}<br/>${svc.ampacityAmps}A utility service`
          : `${svc.serviceId}<br/>Utility service`;
        serviceKeys.set(svc.serviceId, b.node("utility", svc.serviceId, label, undefined, "utility"));
      }
      for (const edge of service.edges) {
        const child = idx.panelById.get(edge.to);
        if (edge.kind === "service") {
          const from = serviceKeys.get(edge.from);
          if (!from) continue;
          b.edge(
            from,
            child ? b.node("panel", edge.to, panelLabel(child), child) : b.node("unknown", edge.to, `${edge.to}<br/>(unknown)`, undefined, "unknown"),
            edge.ampacityAmps ? `service ${edge.ampacityAmps}A` : "service",
          );
        } else {
          const parent = idx.panelById.get(edge.from);
          b.edge(
            parent ? b.node("panel", edge.from, panelLabel(parent), parent) : b.node("unknown", edge.from, `${edge.from}<br/>(unknown)`, undefined, "unknown"),
            child ? b.node("panel", edge.to, panelLabel(child), child) : b.node("unknown", edge.to, `${edge.to}<br/>(unknown)`, undefined, "unknown"),
            "feeder",
          );
        }
      }
      for (const it of service.interties) {
        const a = serviceKeys.get(it.fromServiceId);
        const c = serviceKeys.get(it.toServiceId);
        if (!a || !c) continue;
        const node = b.node("utility", it.intertieId, `${it.intertieId}<br/>${it.normalState || "intertie"}`, undefined, "intertie");
        b.edge(a, node, it.transferMethod || "intertie", true);
        b.edge(node, c, it.normalState || "intertie", true);
      }
      for (const f of servicePanelDomainFindings(service)) {
        b.issue(
          f.severity,
          f.code === "ambiguous_service_domain"
            ? "ambiguous_service_domain"
            : f.code === "panel_feeder_cycle"
              ? "circular_reference"
              : "unresolved_upstream",
          f.message,
        );
      }
    }
    const utility = modelled
      ? ""
      : b.node("utility", "UTILITY", "Utility service", undefined, "utility");
    for (const p of panels) {
      const key = b.node("panel", sid("panel", p), panelLabel(p), p);
      const feeder = s(p["feeder_source"]);
      if (!feeder) {
        // No modelled upstream source: never fabricate a service connection when
        // explicit service identities exist.
        if (utility) b.edge(utility, key, "service");
        continue;
      }
      const upstream = idx.panelById.get(feeder);
      if (upstream) {
        const upKey = b.node("panel", feeder, panelLabel(upstream), upstream);
        b.edge(upKey, key, "feeder");
      } else if (feeder.toUpperCase().startsWith("PNL-")) {
        b.issue("error", "unknown_panel", `Panel ${sid("panel", p)} is fed from unknown panel ${feeder}.`);
        b.edge(b.node("unknown", feeder, `${feeder}<br/>(unknown)`, undefined, "unknown"), key, "feeder");
      } else if (utility) {
        b.edge(utility, key, `feeder: ${feeder}`);
      }
    }
    if (type === "critical_power") {
      for (const p of panels) {
        const cls = s(p["backup_class"]);
        if (!cls) continue;
        const src = b.node("utility", `SRC_${cls}`, `Transfer / ${cls}`, undefined, "utility");
        b.edge(src, b.node("panel", sid("panel", p), panelLabel(p), p), "backup path", true);
      }
    }
  } else {
    for (const p of panels) b.node("panel", sid("panel", p), panelLabel(p), p);
  }

  // ---- raceways
  let raceways = data.raceway.filter((r) => passesCommonFilters(r, filters));
  if (filters.environment) raceways = raceways.filter((r) => s(r["environment"]) === filters.environment);
  if (type === "site") raceways = raceways.filter((r) => isSiteEnvironment(s(r["environment"])));
  if (type === "raceway" && focus) raceways = raceways.filter((r) => sid("raceway", r) === focus);
  if (type === "single_panel" && focus) {
    raceways = raceways.filter(
      (r) => s(r["source_endpoint_ref"]) === focus || s(r["dest_endpoint_ref"]) === focus,
    );
  }
  if (type === "farm_shop") {
    raceways = raceways.filter(
      (r) =>
        farmShopPanels.has(s(r["source_endpoint_ref"])) ||
        farmShopPanels.has(s(r["dest_endpoint_ref"])) ||
        s(r["source_building"]).toLowerCase().includes("farm shop") ||
        s(r["dest_building"]).toLowerCase().includes("farm shop"),
    );
  }
  if (type === "jbox" && focus) {
    // A box in the middle of a continuous run is not an endpoint of it, so the
    // relational junction points count as membership too.
    raceways = raceways.filter(
      (r) =>
        s(r["source_endpoint_ref"]) === focus ||
        s(r["dest_endpoint_ref"]) === focus ||
        orderedJunctionPoints(s(r["id"]), data.jbox).some((p) => p.stableId === focus),
    );
  }
  if (type === "critical_power") {
    raceways = raceways.filter(
      (r) => panelIds.has(s(r["source_endpoint_ref"])) || panelIds.has(s(r["dest_endpoint_ref"])),
    );
  }

  const racewayIds = new Set<string>();
  const jboxIds = new Set<string>();

  for (const r of raceways) {
    const id = sid("raceway", r);
    racewayIds.add(id);
    const key = b.node("raceway", id, racewayLabel(r), r);
    const src = s(r["source_endpoint_ref"]);
    const dst = s(r["dest_endpoint_ref"]);
    if (!src || !dst) {
      b.issue(
        "warning",
        "missing_endpoint",
        `Raceway ${id} is missing a ${!src ? "source" : "destination"} endpoint.`,
      );
    }
    if (src) {
      const from = endpointNode(b, idx, src, `Raceway ${id}`);
      const exit = [s(r["exit_order"]), s(r["exit_side"])].filter(Boolean).join(" ");
      if (from) b.edge(from, key, exit ? `exit ${exit}` : undefined);
    }
    if (dst) {
      const to = endpointNode(b, idx, dst, `Raceway ${id}`);
      const len = s(r["measured_length_ft"]) || s(r["planned_length_ft"]);
      if (to) b.edge(key, to, len ? `${len} ft` : undefined);
      if (idx.jboxById.has(dst)) jboxIds.add(dst);
    }
    if (idx.jboxById.has(src)) jboxIds.add(src);
    if (src === dst && src) {
      b.issue("error", "circular_reference", `Raceway ${id} starts and ends at ${src}.`);
    }

    // ---- ordered junction points along this one continuous raceway
    //
    // CON-104 passing through JB-104-01 → JB-104-02 → JB-104-03 is a single
    // physical run: the chain below shows the physical order, it does not imply
    // separate raceways between the boxes. A branch leaving an intermediate box
    // never terminates the chain.
    const points = orderedJunctionPoints(s(r["id"]), data.jbox).filter((p) => p.stableId);
    let previous: string | null = null;
    const chained = new Set<string>();
    for (const point of points) {
      if (chained.has(point.stableId)) continue;
      chained.add(point.stableId);
      jboxIds.add(point.stableId);
      const jbKey = b.node(
        "jbox",
        point.stableId,
        `${point.stableId}<br/>${s(point.row["box_type"]) || "J-box"}`,
        point.row,
      );
      const label = point.sequence == null ? "junction point" : `junction ${positionLabel(point.sequence)}`;
      b.edge(previous ?? key, jbKey, label);
      previous = jbKey;
    }
    // Route waypoints (site view only — they describe bends, not devices).
    if (type === "site" || type === "raceway") {
      const wps = (data.waypoint ?? [])
        .filter((w) => s(w["raceway_id"]) === s(r["id"]))
        .sort((x, y) => Number(x["sequence"] ?? 0) - Number(y["sequence"] ?? 0));
      for (const w of wps) {
        const wpKey = b.node(
          "unknown",
          `${id}-WP${s(w["sequence"])}`,
          `${s(w["grid"]) || "waypoint"}<br/>${s(w["direction"])}`,
          undefined,
          "waypoint",
        );
        b.edge(key, wpKey, "waypoint", true);
      }
    }
  }

  if (type === "jbox" && focus) jboxIds.add(focus);

  // ---- junction boxes in scope
  for (const jb of data.jbox) {
    const id = sid("jbox", jb);
    if (!jboxIds.has(id)) continue;
    if (!passesCommonFilters(jb, filters)) continue;
    b.node("jbox", id, `${id}<br/>${s(jb["box_type"]) || "J-box"}`, jb);
  }

  // ---- branch runs
  let branches = data.branch.filter((br) => passesCommonFilters(br, filters));
  if (type === "jbox" && focus) {
    branches = branches.filter(
      (br) => s(br["source_endpoint_ref"]) === focus || s(br["dest_endpoint_ref"]) === focus,
    );
  } else if (type === "single_panel" && focus) {
    branches = branches.filter(
      (br) =>
        s(br["source_endpoint_ref"]) === focus ||
        jboxIds.has(s(br["source_endpoint_ref"])) ||
        jboxIds.has(s(br["dest_endpoint_ref"])),
    );
  } else if (type === "raceway" && focus) {
    branches = branches.filter(
      (br) => jboxIds.has(s(br["source_endpoint_ref"])) || jboxIds.has(s(br["dest_endpoint_ref"])),
    );
  } else if (type === "farm_shop") {
    branches = branches.filter(
      (br) =>
        jboxIds.has(s(br["source_endpoint_ref"])) ||
        farmShopPanels.has(s(br["source_endpoint_ref"])) ||
        /^FS-/.test(s(br["dest_endpoint_ref"])),
    );
  } else if (type === "site") {
    branches = [];
  }

  for (const br of branches) {
    const id = sid("branch", br);
    const key = b.node("branch", id, branchLabel(br), br);
    const src = s(br["source_endpoint_ref"]);
    const dst = s(br["dest_endpoint_ref"]);
    if (!src && !dst) {
      b.issue("error", "orphan_branch", `Branch run ${id} has no source or destination endpoint.`);
      continue;
    }
    if (!src) b.issue("warning", "orphan_branch", `Branch run ${id} has no source endpoint.`);
    if (!dst) b.issue("warning", "missing_endpoint", `Branch run ${id} has no destination endpoint.`);
    if (src) {
      const from = endpointNode(b, idx, src, `Branch run ${id}`);
      if (from) b.edge(from, key);
    }
    if (dst) {
      const to = endpointNode(b, idx, dst, `Branch run ${id}`);
      if (to) b.edge(key, to);
    }
    if (src && src === dst) {
      b.issue("error", "circular_reference", `Branch run ${id} starts and ends at ${src}.`);
    }
  }

  // ---- circuit groups and loads
  let groups = data.circuit_group.filter((g) => passesCommonFilters(g, filters));
  if (filters.circuitGroup) {
    groups = groups.filter((g) => sid("circuit_group", g) === filters.circuitGroup);
  }
  if (type === "single_panel" && focus) {
    groups = groups.filter((g) => s(g["suggested_panel"]) === focus);
  } else if (type === "farm_shop") {
    groups = groups.filter((g) => farmShopPanels.has(s(g["suggested_panel"])));
  } else if (type === "critical_power") {
    groups = groups.filter((g) => truthy(g["backup_eligible"]) || truthy(g["critical"]));
  } else if (type === "site" || type === "raceway" || type === "jbox") {
    groups = [];
  }

  for (const g of groups) {
    const id = sid("circuit_group", g);
    const breaker = s(g["breaker_number"]);
    const position = s(g["breaker_position"]);
    const label = [id, s(g["description"])].filter(Boolean).join("<br/>");
    const key = b.node("circuit_group", id, label, g);
    const panelRef = s(g["suggested_panel"]);
    if (!panelRef) {
      b.issue("warning", "missing_endpoint", `Circuit group ${id} is not assigned to a panel.`);
    } else {
      const panel = idx.panelById.get(panelRef);
      if (panel) {
        const pKey = b.node("panel", panelRef, panelLabel(panel), panel);
        const breakerRef = breakerReference(panelRef, breaker);
        const edgeLabel = [
          breakerRef ?? (breaker ? `breaker ${breaker}` : ""),
          position,
        ]
          .filter(Boolean)
          .join(" · ");
        b.edge(pKey, key, edgeLabel || undefined);
      } else {
        b.issue("error", "unknown_panel", `Circuit group ${id} references unknown panel ${panelRef}.`);
        b.edge(
          b.node("unknown", panelRef, `${panelRef}<br/>(unknown)`, undefined, "unknown"),
          key,
        );
      }
    }
  }

  const groupsInScope = new Set(groups.map((g) => sid("circuit_group", g)));
  let loads = data.load.filter((l) => passesCommonFilters(l, filters));
  if (filters.circuitGroup) loads = loads.filter((l) => s(l["circuit_group_ref"]) === filters.circuitGroup);
  if (type === "site") {
    loads = [];
  } else if (type === "critical_power") {
    loads = loads.filter((l) => truthy(l["critical"]) || truthy(l["backup_eligible"]));
  } else if (type === "single_panel" || type === "farm_shop") {
    loads = loads.filter(
      (l) =>
        groupsInScope.has(s(l["circuit_group_ref"])) ||
        b.nodes.has(nodeKey("LOAD", sid("load", l))),
    );
  } else if (type === "raceway" || type === "jbox") {
    loads = loads.filter((l) => b.nodes.has(nodeKey("LOAD", sid("load", l))));
  }

  for (const l of loads) {
    const id = sid("load", l);
    const key = b.node("load", id, `${id}<br/>${s(l["description"])}`, l);
    const ref = s(l["circuit_group_ref"]);
    if (!ref) continue;
    const group = idx.groupById.get(ref);
    if (group) {
      if (groupsInScope.has(ref) || type === "whole_system") {
        const gKey = b.node(
          "circuit_group",
          ref,
          [ref, s(group["description"])].filter(Boolean).join("<br/>"),
          group,
        );
        b.edge(gKey, key);
      }
    } else {
      b.issue("warning", "broken_topology", `Load ${id} references unknown circuit group ${ref}.`);
      b.edge(b.node("unknown", ref, `${ref}<br/>(unknown)`, undefined, "unknown"), key);
    }
  }

  // Orphan branch runs: connected to nothing that exists in the dataset.
  for (const br of data.branch) {
    const id = sid("branch", br);
    const src = s(br["source_endpoint_ref"]);
    const dst = s(br["dest_endpoint_ref"]);
    const known = (ref: string) =>
      !ref ||
      idx.panelById.has(ref) ||
      idx.jboxById.has(ref) ||
      idx.loadById.has(ref) ||
      idx.racewayById.has(ref);
    if (src && dst && !known(src) && !known(dst)) {
      b.issue("error", "orphan_branch", `Branch run ${id} is orphaned — neither endpoint exists.`);
    }
  }

  detectCycles(b);

  return {
    mermaid: renderMermaid([...b.nodes.values()], b.edges, filters, state),
    nodes: [...b.nodes.values()],
    edges: b.edges,
    issues: sortIssues(b.issues),
  };
}

function sortIssues(issues: DiagramIssue[]): DiagramIssue[] {
  const rank = (i: DiagramIssue) => (i.severity === "error" ? 0 : 1);
  return [...issues].sort((a, z) => rank(a) - rank(z) || a.message.localeCompare(z.message));
}

/** Feeder/topology loops are never intentional here, so report them. */
function detectCycles(b: Builder) {
  const adj = new Map<string, string[]>();
  for (const e of b.edges) adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];

  const walk = (n: string) => {
    state.set(n, 1);
    stack.push(n);
    for (const next of adj.get(n) ?? []) {
      const st = state.get(next) ?? 0;
      if (st === 1) {
        const start = stack.indexOf(next);
        const loop = [...stack.slice(start), next]
          .map((k) => b.nodes.get(k)?.stableId ?? k)
          .join(" -> ");
        b.issue("error", "circular_reference", `Circular topology detected: ${loop}.`);
      } else if (st === 0) {
        walk(next);
      }
    }
    stack.pop();
    state.set(n, 2);
  };

  for (const key of [...b.nodes.keys()].sort()) if ((state.get(key) ?? 0) === 0) walk(key);
}

/**
 * Deterministic Mermaid text. Nodes are emitted in insertion order and edges in
 * discovery order, so identical data yields identical output.
 */
export function renderMermaid(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  filters: DiagramFilters,
  state: StateFilter,
): string {
  const lines: string[] = [];
  lines.push("%% FarmOps generated diagram — view only, not authoritative.");
  lines.push(`%% type: ${filters.type}`);
  lines.push(`%% state: ${state}`);
  const active = Object.entries({
    focus: filters.focus,
    panel: filters.panel,
    building: filters.building,
    grid: filters.grid,
    circuitGroup: filters.circuitGroup,
    environment: filters.environment,
  })
    .filter(([, v]) => Boolean(v))
    .map(([k, v]) => `${k}=${v}`);
  lines.push(`%% filters: ${active.length ? active.join(" ") : "none"}`);
  lines.push("flowchart LR");

  if (!nodes.length) {
    lines.push('  EMPTY["No records match these filters"]');
    return lines.join("\n");
  }

  for (const n of nodes) {
    const [open, close] = shapeFor(n.kind);
    lines.push(`  ${n.key}${open}"${mermaidLabel(n.label)}"${close}`);
  }
  for (const e of edges) {
    const arrow = e.dashed ? "-.->" : "-->";
    lines.push(
      e.label ? `  ${e.from} ${arrow}|"${mermaidLabel(e.label)}"| ${e.to}` : `  ${e.from} ${arrow} ${e.to}`,
    );
  }

  lines.push("  classDef utility fill:#334155,stroke:#0f172a,color:#f8fafc;");
  lines.push("  classDef panel fill:#1d4ed8,stroke:#1e3a8a,color:#ffffff;");
  lines.push("  classDef raceway fill:#0f766e,stroke:#134e4a,color:#ffffff;");
  lines.push("  classDef jbox fill:#b45309,stroke:#78350f,color:#ffffff;");
  lines.push("  classDef branch fill:#4d7c0f,stroke:#365314,color:#ffffff;");
  lines.push("  classDef circuit_group fill:#7c3aed,stroke:#4c1d95,color:#ffffff;");
  lines.push("  classDef load fill:#e2e8f0,stroke:#94a3b8,color:#0f172a;");
  lines.push("  classDef critical fill:#b91c1c,stroke:#7f1d1d,color:#ffffff;");
  lines.push("  classDef future fill:#f1f5f9,stroke:#94a3b8,color:#475569,stroke-dasharray: 4 3;");
  lines.push("  classDef rack fill:#0369a1,stroke:#075985,color:#ffffff;");
  lines.push("  classDef power_asset fill:#c2410c,stroke:#7c2d12,color:#ffffff;");
  lines.push("  classDef device fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e;");
  lines.push("  classDef waypoint fill:#ffffff,stroke:#cbd5e1,color:#475569,stroke-dasharray: 2 2;");
  lines.push("  classDef intertie fill:#fef9c3,stroke:#a16207,color:#713f12,stroke-dasharray: 5 3;");
  lines.push("  classDef unknown fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d;");

  const byClass = new Map<string, string[]>();
  for (const n of nodes) byClass.set(n.klass, [...(byClass.get(n.klass) ?? []), n.key]);
  for (const klass of [...byClass.keys()].sort()) {
    lines.push(`  class ${byClass.get(klass)!.join(",")} ${klass};`);
  }

  for (const n of nodes) {
    if (n.href) lines.push(`  click ${n.key} href "${n.href}" "${mermaidLabel(n.stableId)}"`);
  }

  return lines.join("\n");
}


/* ------------------------------------------------- infrastructure views */

export const INFRASTRUCTURE_TYPES = new Set<DiagramType>([
  "network",
  "rack",
  "power_dependency",
]);

function rackLabel(r: Row): string {
  const parts = [s(r["rack_id"])];
  const desc = s(r["description"]) || s(r["rack_role"]);
  if (desc) parts.push(desc);
  const size = s(r["rack_size_u"]);
  if (size) parts.push(`${size}U`);
  return parts.join("<br/>");
}

function powerAssetLabel(r: Row): string {
  const parts = [s(r["power_asset_id"])];
  const type = s(r["asset_type"]);
  if (type) parts.push(type.replace(/_/g, " "));
  const out = [s(r["output_voltage"]) ? `${s(r["output_voltage"])}V` : "", s(r["output_current_amps"]) ? `${s(r["output_current_amps"])}A` : ""]
    .filter(Boolean)
    .join(" / ");
  if (out) parts.push(out);
  return parts.join("<br/>");
}

function deviceLabel(r: Row): string {
  const parts = [s(r["device_id"])];
  const desc = s(r["description"]) || s(r["device_type"]) || s(r["device_role"]);
  if (desc) parts.push(desc);
  return parts.join("<br/>");
}

/**
 * Rack, network and power-dependency views built from the same relational
 * records as the electrical views. Kept as its own builder so the electrical
 * topology diagrams are never widened into an unreadable combined drawing.
 *
 * The power-dependency view preserves both levels of the chain:
 * panel -> circuit / load -> power asset -> powered devices. Devices that share
 * one power asset are attached to that asset, never re-attached individually to
 * the upstream branch circuit.
 */
export function buildInfrastructureDiagram(
  data: ElectricalGraphData,
  filters: DiagramFilters,
): GeneratedDiagram {
  const b = new Builder();
  const state = filters.state ?? "all";
  const type = filters.type;
  const focus = (filters.focus ?? "").trim();

  const racks = (data.rack ?? []).filter((r) => passesCommonFilters(r, filters));
  const assets = (data.power_asset ?? []).filter((r) => passesCommonFilters(r, filters));
  let devices = (data.device ?? []).filter((r) => passesCommonFilters(r, filters));
  if (type === "network") {
    devices = devices.filter(
      (d) => s(d["device_role"]).toUpperCase() === "NETWORK" || s(d["uplink_device_ref"]) !== "",
    );
  }
  if (focus) {
    if (type === "rack") {
      const keep = focus.toUpperCase();
      const inRack = (row: Row) => s(row["rack_ref"]).toUpperCase() === keep;
      devices = devices.filter(inRack);
    }
    if (type === "power_dependency") {
      const keep = focus.toUpperCase();
      devices = devices.filter((d) => s(d["power_asset_ref"]).toUpperCase() === keep);
    }
  }

  const rackById = new Map<string, Row>();
  for (const r of racks) if (sid("rack", r)) rackById.set(sid("rack", r), r);
  const assetById = new Map<string, Row>();
  for (const a of assets) if (sid("power_asset", a)) assetById.set(sid("power_asset", a), a);
  const panelById = new Map<string, Row>();
  for (const p of data.panel ?? []) if (sid("panel", p)) panelById.set(sid("panel", p), p);
  const groupById = new Map<string, Row>();
  for (const g of data.circuit_group ?? []) {
    if (sid("circuit_group", g)) groupById.set(sid("circuit_group", g), g);
  }
  const loadById = new Map<string, Row>();
  for (const l of data.load ?? []) if (sid("load", l)) loadById.set(sid("load", l), l);

  const rackNode = (id: string): string | null => {
    if (!id) return null;
    const row = rackById.get(id);
    if (row) return b.node("rack", id, rackLabel(row), row);
    b.issue("warning", "broken_topology", `Unknown equipment rack ${id} is referenced.`);
    return b.node("unknown", id, `${id}<br/>(unknown rack)`, undefined, "unknown");
  };

  const assetNode = (id: string): string | null => {
    if (!id) return null;
    const row = assetById.get(id);
    if (row) return b.node("power_asset", id, powerAssetLabel(row), row);
    b.issue("warning", "broken_topology", `Unknown power asset ${id} is referenced.`);
    return b.node("unknown", id, `${id}<br/>(unknown power asset)`, undefined, "unknown");
  };

  if (type === "rack") {
    for (const r of racks) {
      if (focus && sid("rack", r) !== focus) continue;
      rackNode(sid("rack", r));
    }
    for (const a of assets) {
      const rack = s(a["rack_ref"]);
      if (focus && rack.toUpperCase() !== focus.toUpperCase()) continue;
      const key = b.node("power_asset", sid("power_asset", a), powerAssetLabel(a), a);
      const rk = rackNode(rack);
      if (rk) b.edge(rk, key, "mounted in");
    }
    for (const d of devices) {
      const key = b.node("device", sid("device", d), deviceLabel(d), d);
      const rk = rackNode(s(d["rack_ref"]));
      const slot = s(d["rack_position_u"]);
      if (rk) b.edge(rk, key, slot ? `U${slot}` : undefined);
    }
  }

  if (type === "network") {
    for (const d of devices) {
      const key = b.node("device", sid("device", d), deviceLabel(d), d);
      const rack = s(d["rack_ref"]);
      if (rack) {
        const rk = rackNode(rack);
        if (rk) b.edge(rk, key, "houses", true);
      }
      const uplink = s(d["uplink_device_ref"]);
      if (!uplink) continue;
      const up = devices.find((x) => sid("device", x) === uplink) ?? null;
      if (up) {
        b.edge(b.node("device", uplink, deviceLabel(up), up), key, "uplink");
      } else {
        b.issue("warning", "broken_topology", `Device ${sid("device", d)} uplinks to unknown device ${uplink}.`);
        b.edge(b.node("unknown", uplink, `${uplink}<br/>(unknown)`, undefined, "unknown"), key, "uplink");
      }
    }
  }

  if (type === "power_dependency") {
    for (const a of assets) {
      const id = sid("power_asset", a);
      const key = b.node("power_asset", id, powerAssetLabel(a), a);
      // Upstream electrical source at the most specific known level.
      const upstreamAsset = s(a["upstream_power_asset_ref"]);
      const load = s(a["source_load_ref"]);
      const group = s(a["source_circuit_group_ref"]);
      const panel = s(a["source_panel_ref"]);
      if (upstreamAsset) {
        const up = assetNode(upstreamAsset);
        if (up) b.edge(up, key, "feeds");
      }
      if (load && loadById.has(load)) {
        const row = loadById.get(load)!;
        b.edge(b.node("load", load, `${load}<br/>${s(row["description"])}`, row), key, "outlet");
      }
      if (group && groupById.has(group)) {
        const row = groupById.get(group)!;
        b.edge(
          b.node("circuit_group", group, [group, s(row["description"])].filter(Boolean).join("<br/>"), row),
          key,
          "circuit",
        );
      }
      if (panel && panelById.has(panel)) {
        const row = panelById.get(panel)!;
        const target = group && groupById.has(group)
          ? b.node("circuit_group", group, [group, s(groupById.get(group)!["description"])].filter(Boolean).join("<br/>"), groupById.get(group)!)
          : key;
        b.edge(b.node("panel", panel, panelLabel(row), row), target, "panel");
      }
      if (!upstreamAsset && !load && !group && !panel) {
        b.issue(
          "warning",
          "missing_endpoint",
          `Power asset ${id} has no recorded upstream power source.`,
        );
      }
    }

    for (const d of devices) {
      const key = b.node("device", sid("device", d), deviceLabel(d), d);
      const asset = s(d["power_asset_ref"]);
      if (asset) {
        const ak = assetNode(asset);
        if (ak) b.edge(ak, key, "powers");
        continue;
      }
      // No power asset: the device is fed directly from the electrical system.
      const load = s(d["load_ref"]);
      const group = s(d["circuit_group_ref"]);
      if (load && loadById.has(load)) {
        const row = loadById.get(load)!;
        b.edge(b.node("load", load, `${load}<br/>${s(row["description"])}`, row), key, "direct");
      } else if (group && groupById.has(group)) {
        const row = groupById.get(group)!;
        b.edge(
          b.node("circuit_group", group, [group, s(row["description"])].filter(Boolean).join("<br/>"), row),
          key,
          "direct",
        );
      } else {
        b.issue(
          "warning",
          "missing_endpoint",
          `Device ${sid("device", d)} has no recorded power source.`,
        );
      }
    }
  }

  detectCycles(b);

  return {
    mermaid: renderMermaid([...b.nodes.values()], b.edges, filters, state),
    nodes: [...b.nodes.values()],
    edges: b.edges,
    issues: sortIssues(b.issues),
  };
}
