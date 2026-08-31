// Bridge between the service-revision model (Electrical → Services) and the
// generated topology views. There is exactly ONE resolution algorithm for
// service-to-panel relationships: `buildServicePanelTopology()` from
// electrical-services.ts. This module only projects its result onto the panel
// graph and classifies every panel's service domain — it never invents a
// service edge for a panel that has no modelled upstream source.

import {
  buildServicePanelTopology,
  currentIntertieConfiguration,
  currentServiceConfiguration,
  groupByParent,
  type ServicePanelNode,
} from "@/lib/electrical-services";
import type { Row } from "@/lib/electrical-mermaid";

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

export type PanelDomainStatus =
  | "service_rooted"
  | "downstream"
  | "unresolved"
  | "ambiguous"
  | "cycle";

export interface ServiceRoot {
  serviceUuid: string;
  serviceId: string;
  configUuid: string;
  /** Present ampacity of the energized revision, if recorded. */
  ampacityAmps: string;
  roots: ServicePanelNode[];
}

export interface ServicePanelEdge {
  from: string;
  to: string;
  /** service = fed from service equipment, feeder = fed from another panel. */
  kind: "service" | "feeder";
  ampacityAmps: string;
}

export interface IntertieLink {
  intertieId: string;
  fromServiceId: string;
  toServiceId: string;
  normalState: string;
  transferMethod: string;
}

export interface ServiceTopologyInput {
  panels?: Row[];
  services?: Row[];
  serviceConfigs?: Row[];
  servicePanels?: Row[];
  interties?: Row[];
  intertieConfigs?: Row[];
}

export interface ServiceTopologyResolution {
  /** Empty when no explicit service identity is modelled yet. */
  services: ServiceRoot[];
  edges: ServicePanelEdge[];
  /** Panels the current revisions attach directly to service equipment. */
  serviceRootedPanels: Set<string>;
  /** panel stable id/ref -> service ids it can be reached from. */
  domains: Map<string, string[]>;
  status: Map<string, PanelDomainStatus>;
  interties: IntertieLink[];
}

function flatten(node: ServicePanelNode, out: ServicePanelNode[]) {
  out.push(node);
  for (const c of node.children) flatten(c, out);
}

/**
 * Resolve current-state service topology. Only the energized revision of each
 * service participates: a stored planned/proposed redesign never appears here.
 */
export function resolveServiceTopology(
  input: ServiceTopologyInput,
): ServiceTopologyResolution {
  const configsByService = groupByParent(input.serviceConfigs ?? [], "service_uuid");
  const linksByConfig = groupByParent(input.servicePanels ?? [], "service_config_uuid");

  const services: ServiceRoot[] = [];
  const edges: ServicePanelEdge[] = [];
  const serviceRootedPanels = new Set<string>();
  const domains = new Map<string, string[]>();
  const status = new Map<string, PanelDomainStatus>();

  const addDomain = (panelRef: string, serviceId: string) => {
    if (!panelRef || !serviceId) return;
    const list = domains.get(panelRef) ?? [];
    if (!list.includes(serviceId)) list.push(serviceId);
    domains.set(panelRef, list);
  };

  const ordered = [...(input.services ?? [])].sort((a, b) =>
    str(a["service_id"]).localeCompare(str(b["service_id"])),
  );

  for (const svc of ordered) {
    const uuid = str(svc["id"]);
    const serviceId = str(svc["service_id"]) || uuid;
    const current = currentServiceConfiguration(configsByService.get(uuid) ?? []);
    if (!current) {
      services.push({ serviceUuid: uuid, serviceId, configUuid: "", ampacityAmps: "", roots: [] });
      continue;
    }
    const links = linksByConfig.get(str(current["id"])) ?? [];
    const roots = buildServicePanelTopology(links);
    services.push({
      serviceUuid: uuid,
      serviceId,
      configUuid: str(current["id"]),
      ampacityAmps: str(current["ampacity_amps"]),
      roots,
    });

    for (const root of roots) {
      serviceRootedPanels.add(root.panelRef);
      edges.push({
        from: serviceId,
        to: root.panelRef,
        kind: "service",
        ampacityAmps: root.ampacityAmps,
      });
      const all: ServicePanelNode[] = [];
      flatten(root, all);
      for (const node of all) {
        addDomain(node.panelRef, serviceId);
        for (const child of node.children) {
          edges.push({
            from: node.panelRef,
            to: child.panelRef,
            kind: "feeder",
            ampacityAmps: child.ampacityAmps,
          });
        }
      }
    }
  }

  // ---- service-domain inheritance through real panel feeder relationships.
  // This assigns a domain; it never adds another service edge.
  const panels = input.panels ?? [];
  const feederOf = new Map<string, string>();
  const panelIds = new Set<string>();
  for (const p of panels) {
    const id = str(p["panel_id"]);
    if (!id) continue;
    panelIds.add(id);
    const src = str(p["feeder_source"]);
    if (src && src !== id) feederOf.set(id, src);
  }

  const cyclic = new Set<string>();
  const resolveUpstream = (id: string): string[] => {
    const seen = new Set<string>([id]);
    let cursor: string | undefined = id;
    while (cursor) {
      const known = domains.get(cursor);
      if (known?.length) return known;
      const next: string | undefined = feederOf.get(cursor);
      if (!next) return [];
      if (seen.has(next)) {
        cyclic.add(id);
        return [];
      }
      seen.add(next);
      cursor = next;
    }
    return [];
  };

  for (const id of panelIds) {
    if (domains.has(id)) continue;
    const inherited = resolveUpstream(id);
    for (const svc of inherited) addDomain(id, svc);
  }

  for (const id of panelIds) {
    const list = domains.get(id) ?? [];
    if (cyclic.has(id)) status.set(id, "cycle");
    else if (list.length > 1) status.set(id, "ambiguous");
    else if (!list.length) status.set(id, "unresolved");
    else if (serviceRootedPanels.has(id)) status.set(id, "service_rooted");
    else status.set(id, "downstream");
  }
  // Revision members that are not (yet) panel records still deserve a status.
  for (const [ref, list] of domains) {
    if (status.has(ref)) continue;
    status.set(ref, serviceRootedPanels.has(ref) ? "service_rooted" : "downstream");
    void list;
  }

  // ---- interties: only the commissioned/current revision is operational.
  const intertieConfigs = groupByParent(input.intertieConfigs ?? [], "intertie_uuid");
  const serviceIdByUuid = new Map<string, string>();
  for (const svc of ordered) serviceIdByUuid.set(str(svc["id"]), str(svc["service_id"]));
  const resolveService = (row: Row, uuidKey: string, refKey: string) =>
    serviceIdByUuid.get(str(row[uuidKey])) || str(row[refKey]);

  const interties: IntertieLink[] = [];
  for (const it of [...(input.interties ?? [])].sort((a, b) =>
    str(a["intertie_id"]).localeCompare(str(b["intertie_id"])),
  )) {
    const cfg = currentIntertieConfiguration(intertieConfigs.get(str(it["id"])) ?? []);
    if (!cfg) continue;
    const from = resolveService(cfg, "endpoint_a_service_uuid", "endpoint_a_ref");
    const to = resolveService(cfg, "endpoint_b_service_uuid", "endpoint_b_ref");
    if (!from || !to) continue;
    interties.push({
      intertieId: str(it["intertie_id"]) || str(it["id"]),
      fromServiceId: from,
      toServiceId: to,
      normalState: str(cfg["normal_state"]),
      transferMethod: str(cfg["transfer_method"]),
    });
  }

  return { services, edges, serviceRootedPanels, domains, status, interties };
}

export interface PanelDomainFinding {
  code: "unresolved_upstream_topology" | "ambiguous_service_domain" | "panel_feeder_cycle";
  severity: "error" | "warning";
  panelRef: string;
  message: string;
}

/**
 * QA only — nothing here repairs a panel. A panel that cannot be reached from
 * exactly one current utility service is reported, never attached to one.
 */
export function servicePanelDomainFindings(
  resolution: ServiceTopologyResolution,
): PanelDomainFinding[] {
  if (!resolution.services.length) return [];
  const out: PanelDomainFinding[] = [];
  for (const [panelRef, state] of [...resolution.status].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (state === "unresolved") {
      out.push({
        code: "unresolved_upstream_topology",
        severity: "warning",
        panelRef,
        message:
          `${panelRef} cannot be reached from any current utility service. Record its upstream feeder or add it ` +
          `to the current service revision — FarmOps will not assume a utility-service connection.`,
      });
    } else if (state === "ambiguous") {
      out.push({
        code: "ambiguous_service_domain",
        severity: "error",
        panelRef,
        message: `${panelRef} is reachable from more than one utility service (${(resolution.domains.get(panelRef) ?? []).join(", ")}). Exactly one service domain may feed a panel.`,
      });
    } else if (state === "cycle") {
      out.push({
        code: "panel_feeder_cycle",
        severity: "error",
        panelRef,
        message: `${panelRef} is part of a circular panel feeder chain, so no utility service can be resolved.`,
      });
    }
  }
  return out;
}
