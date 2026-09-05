// FARMOPS-ELEC-PANEL-COMPLETENESS-V1 — derive every panel result from stored
// records. Pure: no writes, no cached authoritative percentage, and no invented
// record. Callers may memoize the output and recalculate at will.
import type { InstallProgressSnapshot } from "@/lib/electrical-install-progress.functions";
import {
  buildPanelCompleteness,
  deriveMilestones,
  DONE_STAGES,
  type ElectricalMilestone,
  type PanelCompleteness,
  type PanelHold,
  type PositionRecord,
  type ScopedCircuit,
} from "@/lib/electrical-lifecycle";

const txt = (v: unknown) => (v == null ? "" : String(v).trim());
const done = (v: unknown) => DONE_STAGES.includes(txt(v).toLowerCase());

export interface PanelCompletenessOptions {
  /** Explicitly not-applicable milestones per circuit stable ID (e.g. no raceway). */
  notApplicable?: Record<string, readonly ElectricalMilestone[]>;
  /** Milestones proven by accepted field evidence, per circuit stable ID. */
  evidence?: Record<string, readonly ElectricalMilestone[]>;
  /** Held / conflicting audit items for this panel. */
  holds?: readonly PanelHold[];
  evidenceSource?: string | null;
  calculatedAt?: string;
}

/**
 * Declared installation scope for a panel = the circuit groups that actually have
 * a breaker position on it. Spare, reserved and unclassified positions are never
 * part of the scope, so they cannot dilute completion.
 */
export function panelCompletenessFromSnapshot(
  snapshot: InstallProgressSnapshot,
  panelUuid: string,
  options: PanelCompletenessOptions = {},
): PanelCompleteness | null {
  const panel = snapshot.panels.find((p) => p.id === panelUuid);
  if (!panel) return null;

  const positions: PositionRecord[] = snapshot.positions
    .filter((p) => p.panel_uuid === panelUuid)
    .map((p) => ({
      position: p.position,
      poles: p.poles,
      label: p.label,
      circuit_group_uuid: p.circuit_group_uuid,
      install_status: p.install_status,
    }));

  const positionByCircuit = new Map(
    snapshot.positions
      .filter((p) => p.panel_uuid === panelUuid && p.circuit_group_uuid)
      .map((p) => [p.circuit_group_uuid as string, p]),
  );

  const loadsByCircuit = new Map<string, InstallProgressSnapshot["loads"]>();
  for (const l of snapshot.loads) {
    if (!l.circuit_group_uuid) continue;
    const list = loadsByCircuit.get(l.circuit_group_uuid);
    if (list) list.push(l);
    else loadsByCircuit.set(l.circuit_group_uuid, [l]);
  }

  const circuits: ScopedCircuit[] = [];
  let identified = 0;
  let connected = 0;
  let verified = 0;

  for (const c of snapshot.circuits) {
    const pos = positionByCircuit.get(c.id);
    const onPanel = c.panel_uuid === panelUuid || Boolean(pos);
    if (!onPanel) continue;
    const ref = txt(c.circuit_group_id);
    const loads = loadsByCircuit.get(c.id) ?? [];
    const loadsDone = loads.filter((l) => done(l.install_status));
    identified += loads.length;
    connected += loadsDone.length;
    verified += loads.filter((l) => txt(l.install_status) === "as_built_verified").length;

    const evidence = new Set<ElectricalMilestone>(options.evidence?.[ref] ?? []);
    // Every connected load carrying accepted field evidence proves the load-side
    // termination of its circuit. Testing and energization are never inferred.
    if (loadsDone.length > 0) evidence.add("load_termination");
    // As-built verification requires accepted evidence on every connected load.
    const allVerified =
      loads.length > 0 &&
      loads.every((l) => txt(l.install_status) === "as_built_verified");
    if (allVerified) evidence.add("as_built_verified");
    else evidence.delete("as_built_verified");

    circuits.push({
      circuit_group_id: ref,
      in_scope: Boolean(pos),
      milestones: deriveMilestones({
        install_status: c.install_status,
        breaker_installed: Boolean(pos) && !["", "planned"].includes(txt(pos?.install_status)),
        not_applicable: options.notApplicable?.[ref] ?? [],
        evidence: [...evidence],
      }),
      connectedLoads: loads.length,
      completedLoads: loadsDone.length,
    });
  }

  return buildPanelCompleteness({
    panel_id: txt(panel.panel_id),
    infrastructure_status: panel.install_status,
    usablePositions: Number(panel.spaces ?? 0) || 0,
    positions,
    circuits,
    identifiedLoads: identified,
    connectedLoads: connected,
    verifiedLoads: verified,
    holds: options.holds ?? [],
    ...(options.evidenceSource !== undefined
      ? { evidenceSource: options.evidenceSource }
      : {}),
    ...(options.calculatedAt ? { calculatedAt: options.calculatedAt } : {}),
  });
}

/** Milestone counts as CSV, using exactly the terminology shown in the UI. */
export function panelCompletenessCsv(result: PanelCompleteness): string {
  const rows: string[][] = [
    ["panel_id", "metric", "complete", "applicable", "percent", "denominator"],
    [
      result.panel_id,
      "Capacity utilization (poles)",
      String(result.capacity.occupiedPositions),
      String(result.capacity.usablePositions),
      String(result.capacity.utilizationPercent),
      result.capacity.denominator,
    ],
    [
      result.panel_id,
      "Position documentation coverage",
      String(result.positionClasses.classified),
      String(result.capacity.usablePositions),
      String(result.positionClasses.documentationCoveragePercent),
      result.positionClasses.denominator,
    ],
    [
      result.panel_id,
      "Circuit rollout (in-scope milestones)",
      String(result.rollout.completedMilestones),
      String(result.rollout.applicableMilestones),
      String(result.rollout.rolloutPercent),
      result.rollout.denominator,
    ],
    [
      result.panel_id,
      "Identified loads connected",
      String(result.loads.connected),
      String(result.loads.identified),
      String(result.loads.percent),
      result.loads.denominator,
    ],
  ];
  for (const c of result.rollout.counts) {
    rows.push([
      result.panel_id,
      c.label,
      String(c.complete),
      String(c.applicable),
      String(c.percent),
      `Applicable in-scope circuits only; ${c.notApplicable} not applicable, ${c.unknown} with no record yet.`,
    ]);
  }
  for (const h of result.holds) {
    rows.push([result.panel_id, `Hold (${h.kind})`, "0", "0", "", `${h.ref}: ${h.reason}`]);
  }
  return rows
    .map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(","))
    .join("\n");
}
