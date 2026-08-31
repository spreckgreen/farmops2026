// Utility service identity vs. service configuration.
//
// Amendment rule this module enforces: a service's stable ID is a permanent
// LOGICAL identity (SVC-HOUSE, SVC-FS). It never encodes ampacity, voltage,
// meter arrangement, panel count, panel IDs or any other current-state
// attribute. All of that is mutable configuration stored in dated,
// lifecycle-tagged configuration revisions, so the House service can move from
// 200 A to a proposed 400 A design — and be redesigned downstream — without
// SVC-HOUSE ever being renamed, replaced or duplicated.
//
// Nothing here hard-codes "House = 200 A" or "Farm Shop = 400 A": every rating,
// voltage, panel relationship and intertie attribute is data.

export type Row = Record<string, unknown>;

// ------------------------------------------------------------------ lifecycle

/**
 * Design/lifecycle state of a configuration revision. Multiple revisions of one
 * service coexist: exactly one may be the current as-built state, while any
 * number of planned/proposed future designs are stored alongside it without
 * pretending they are energized.
 */
export const SERVICE_LIFECYCLE_STATES = [
  "existing",
  "planned",
  "proposed",
  "retired",
] as const;
export type ServiceLifecycleState = (typeof SERVICE_LIFECYCLE_STATES)[number];

export function serviceLifecycleLabel(value: unknown): string {
  const map: Record<string, string> = {
    existing: "Existing / as-built",
    planned: "Planned",
    proposed: "Proposed",
    retired: "Retired / superseded",
  };
  const key = String(value ?? "").trim();
  return map[key] ?? key;
}

/**
 * Intertie lifecycle. The House/Farm Shop intertie is not yet engineered, so it
 * must be able to travel from a concept through commissioning, and be redesigned
 * later, as editable data rather than assumptions baked into code.
 */
export const INTERTIE_LIFECYCLE_STATES = [
  "concept",
  "proposed",
  "engineered",
  "approved",
  "installed",
  "commissioned",
  "retired",
] as const;
export type IntertieLifecycleState = (typeof INTERTIE_LIFECYCLE_STATES)[number];

export function intertieLifecycleLabel(value: unknown): string {
  const map: Record<string, string> = {
    concept: "Concept",
    proposed: "Proposed",
    engineered: "Engineered",
    approved: "Approved",
    installed: "Installed",
    commissioned: "Commissioned",
    retired: "Retired / superseded",
  };
  const key = String(value ?? "").trim();
  return map[key] ?? key;
}

/** States that describe a physically energized, as-built arrangement. */
export const ENERGIZED_INTERTIE_STATES = new Set<string>(["installed", "commissioned"]);

/** Future-design states: stored, analyzable, never treated as energized. */
export function isFutureState(value: unknown): boolean {
  const s = String(value ?? "").trim();
  return s === "planned" || s === "proposed" || s === "concept" || s === "engineered" || s === "approved";
}

// ----------------------------------------------------------------- stable IDs

export const SERVICE_ID_SHAPE = "SVC-<SITE>";
export const SERVICE_ID_PATTERN = /^SVC-[A-Z][A-Z0-9]{1,15}$/;

export const INTERTIE_ID_SHAPE = "ITIE-<SITE_A>-<SITE_B>";
export const INTERTIE_ID_PATTERN = /^ITIE-[A-Z][A-Z0-9]{1,15}-[A-Z][A-Z0-9]{1,15}$/;

/**
 * Tokens that would smuggle mutable configuration into the identity: ampacity
 * (200A, 400AMP), voltage (240V, 120/240), phase, panel counts.
 */
const CONFIG_IN_ID = [
  /\d+\s*A(MP|MPS)?$/,
  /\d+\s*V(OLT|OLTS)?$/,
  /\d+P(H|HASE)?$/,
  /\d+PNL$/,
  /\d+PANEL S?$/,
];

export interface IdCheck {
  ok: boolean;
  error?: string;
}

export function checkServiceId(raw: unknown): IdCheck {
  const id = String(raw ?? "").trim();
  if (!id) {
    return { ok: false, error: `A service ID is required — use ${SERVICE_ID_SHAPE}, e.g. SVC-HOUSE.` };
  }
  if (id !== id.toUpperCase()) {
    return { ok: false, error: `${id} must be upper case — use ${id.toUpperCase()}.` };
  }
  if (/\s/.test(id)) {
    return { ok: false, error: `Service IDs cannot contain spaces. Example: SVC-HOUSE.` };
  }
  const tail = id.split("-").slice(1).join("-");
  if (CONFIG_IN_ID.some((re) => re.test(tail))) {
    return {
      ok: false,
      error:
        `${id} encodes current configuration (ampacity, voltage, phase or panel count) in the service identity. ` +
        `The identity is permanent — use ${SERVICE_ID_SHAPE} (e.g. SVC-HOUSE) and record ${tail} as a configuration revision instead, ` +
        `so a later upgrade never requires a new service ID.`,
    };
  }
  if (!SERVICE_ID_PATTERN.test(id)) {
    return {
      ok: false,
      error: `${id} does not match the required service ID format ${SERVICE_ID_SHAPE} — e.g. SVC-HOUSE, SVC-FS.`,
    };
  }
  return { ok: true };
}

export function checkIntertieId(raw: unknown): IdCheck {
  const id = String(raw ?? "").trim();
  if (!id) {
    return { ok: false, error: `An intertie ID is required — use ${INTERTIE_ID_SHAPE}, e.g. ITIE-HOUSE-FS.` };
  }
  if (id !== id.toUpperCase()) {
    return { ok: false, error: `${id} must be upper case — use ${id.toUpperCase()}.` };
  }
  const tail = id.split("-").slice(1).join("-");
  if (CONFIG_IN_ID.some((re) => re.test(tail))) {
    return {
      ok: false,
      error:
        `${id} encodes transfer capacity or voltage in the intertie identity. Use ${INTERTIE_ID_SHAPE} ` +
        `(e.g. ITIE-HOUSE-FS) and record capacity, transfer method and operating states as configuration.`,
    };
  }
  if (!INTERTIE_ID_PATTERN.test(id)) {
    return {
      ok: false,
      error: `${id} does not match the required intertie ID format ${INTERTIE_ID_SHAPE} — e.g. ITIE-HOUSE-FS.`,
    };
  }
  return { ok: true };
}

// ------------------------------------------------------- configuration lookup

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const bool = (v: unknown) => v === true || v === "true";

function dateKey(row: Row): string {
  return (
    str(row["commissioned_date"]) || str(row["effective_date"]) || str(row["created_at"]) || ""
  );
}

/** Newest-first ordering, deterministic on ties via id. */
function byRecency(a: Row, b: Row): number {
  const d = dateKey(b).localeCompare(dateKey(a));
  return d !== 0 ? d : str(a["id"]).localeCompare(str(b["id"]));
}

/**
 * The configuration that is actually energized right now for one service.
 *
 * Preference order: the explicitly flagged current revision, otherwise the most
 * recent non-retired `existing` revision. Planned/proposed revisions are never
 * selected — storing a future design must not make QA behave as if the upgrade
 * already happened.
 */
export function currentServiceConfiguration(configs: Row[]): Row | null {
  const rows = configs ?? [];
  const flagged = rows.filter((r) => bool(r["is_current"]) && !str(r["retired_date"]));
  if (flagged.length) return [...flagged].sort(byRecency)[0];
  const asBuilt = rows.filter(
    (r) => str(r["lifecycle_state"]) === "existing" && !str(r["retired_date"]),
  );
  if (asBuilt.length) return [...asBuilt].sort(byRecency)[0];
  return null;
}

/** Stored future designs for one service, newest first. Never energized. */
export function futureServiceConfigurations(configs: Row[]): Row[] {
  return (configs ?? [])
    .filter((r) => isFutureState(r["lifecycle_state"]) && !bool(r["is_current"]))
    .sort(byRecency);
}

export function currentIntertieConfiguration(configs: Row[]): Row | null {
  const rows = configs ?? [];
  const flagged = rows.filter((r) => bool(r["is_current"]) && !str(r["retired_date"]));
  if (flagged.length) return [...flagged].sort(byRecency)[0];
  const live = rows.filter(
    (r) => ENERGIZED_INTERTIE_STATES.has(str(r["lifecycle_state"])) && !str(r["retired_date"]),
  );
  if (live.length) return [...live].sort(byRecency)[0];
  return null;
}

/** Group configuration rows by their parent UUID column. */
export function groupByParent(rows: Row[], column: string): Map<string, Row[]> {
  const out = new Map<string, Row[]>();
  for (const r of rows ?? []) {
    const key = str(r[column]);
    if (!key) continue;
    const list = out.get(key) ?? [];
    list.push(r);
    out.set(key, list);
  }
  return out;
}

// ---------------------------------------------------- lifecycle transitions

export interface ConfigurationPatch {
  id: string;
  patch: Record<string, unknown>;
  reason: string;
}

/**
 * Pure plan for the explicit "this upgrade is now commissioned" transition.
 *
 * Nothing is deleted or renamed: the target revision becomes the current
 * as-built configuration, and the revision it replaces is marked retired with a
 * date so history stays readable. Only after this transition does current-state
 * QA evaluate the new configuration.
 */
export function planCommissionServiceConfiguration(
  configs: Row[],
  targetId: string,
  opts: { date?: string; energizedState?: ServiceLifecycleState } = {},
): ConfigurationPatch[] {
  const rows = configs ?? [];
  const target = rows.find((r) => str(r["id"]) === str(targetId));
  if (!target) return [];
  const date = opts.date || new Date().toISOString().slice(0, 10);
  const state = opts.energizedState ?? "existing";
  const patches: ConfigurationPatch[] = [];
  for (const r of rows) {
    const id = str(r["id"]);
    if (id === str(targetId)) continue;
    if (!bool(r["is_current"]) && str(r["lifecycle_state"]) !== "existing") continue;
    if (str(r["retired_date"])) continue;
    patches.push({
      id,
      patch: { is_current: false, lifecycle_state: "retired", retired_date: date },
      reason: `Superseded by ${str(target["revision_label"]) || str(target["id"])}`,
    });
  }
  patches.push({
    id: str(target["id"]),
    patch: {
      is_current: true,
      lifecycle_state: state,
      commissioned_date: str(target["commissioned_date"]) || date,
      retired_date: null,
    },
    reason: "Commissioned as the current as-built configuration",
  });
  return patches;
}

export function planCommissionIntertieConfiguration(
  configs: Row[],
  targetId: string,
  opts: { date?: string } = {},
): ConfigurationPatch[] {
  const rows = configs ?? [];
  const target = rows.find((r) => str(r["id"]) === str(targetId));
  if (!target) return [];
  const date = opts.date || new Date().toISOString().slice(0, 10);
  const patches: ConfigurationPatch[] = [];
  for (const r of rows) {
    const id = str(r["id"]);
    if (id === str(targetId)) continue;
    if (!bool(r["is_current"]) && !ENERGIZED_INTERTIE_STATES.has(str(r["lifecycle_state"]))) continue;
    if (str(r["retired_date"])) continue;
    patches.push({
      id,
      patch: { is_current: false, lifecycle_state: "retired", retired_date: date },
      reason: `Superseded by ${str(target["revision_label"]) || str(target["id"])}`,
    });
  }
  patches.push({
    id: str(target["id"]),
    patch: {
      is_current: true,
      lifecycle_state: "commissioned",
      commissioned_date: str(target["commissioned_date"]) || date,
      retired_date: null,
    },
    reason: "Commissioned as the current intertie arrangement",
  });
  return patches;
}

// -------------------------------------------------------------------- QA

export type ServiceFindingSeverity = "error" | "warning" | "info";

export interface ServiceFinding {
  code: string;
  severity: ServiceFindingSeverity;
  serviceId: string;
  message: string;
}

export interface ServiceQaInput {
  services: Row[];
  configs: Row[];
  interties?: Row[];
  intertieConfigs?: Row[];
}

/**
 * QA over the ACTIVE topology only.
 *
 * A stored planned/proposed revision is never a defect and never contributes a
 * second energized configuration: it is reported as information so the future
 * design is visible without failing the as-built system.
 */
export function validateServiceState(input: ServiceQaInput): ServiceFinding[] {
  const findings: ServiceFinding[] = [];
  const byService = groupByParent(input.configs ?? [], "service_uuid");

  for (const svc of input.services ?? []) {
    const uuid = str(svc["id"]);
    const sid = str(svc["service_id"]) || uuid;

    const idCheck = checkServiceId(sid);
    if (!idCheck.ok) {
      findings.push({ code: "service_id_format", severity: "error", serviceId: sid, message: idCheck.error! });
    }

    const configs = byService.get(uuid) ?? [];
    const energized = configs.filter(
      (r) => (bool(r["is_current"]) || str(r["lifecycle_state"]) === "existing") && !str(r["retired_date"]),
    );
    if (energized.length > 1) {
      findings.push({
        code: "multiple_current_configurations",
        severity: "error",
        serviceId: sid,
        message:
          `${sid} has ${energized.length} configurations marked as energized. Exactly one revision may be current; ` +
          `future designs must stay in planned or proposed until the upgrade is commissioned.`,
      });
    }

    const current = currentServiceConfiguration(configs);
    if (!current) {
      findings.push({
        code: "no_current_configuration",
        severity: "warning",
        serviceId: sid,
        message: `${sid} has no current as-built configuration recorded. Its identity is fine; add an existing revision with the present ampacity, voltage and service equipment.`,
      });
    } else {
      if (!str(current["ampacity_amps"])) {
        findings.push({
          code: "current_configuration_incomplete",
          severity: "warning",
          serviceId: sid,
          message: `The current configuration for ${sid} does not state service ampacity. This is missing information, not a contradiction.`,
        });
      }
      if (!str(current["voltage"]) || !str(current["phase"])) {
        findings.push({
          code: "current_configuration_incomplete",
          severity: "warning",
          serviceId: sid,
          message: `The current configuration for ${sid} does not state voltage and phase.`,
        });
      }
    }

    for (const future of futureServiceConfigurations(configs)) {
      findings.push({
        code: "future_configuration_recorded",
        severity: "info",
        serviceId: sid,
        message:
          `${sid} has a ${serviceLifecycleLabel(future["lifecycle_state"]).toLowerCase()} configuration ` +
          `${str(future["revision_label"]) || "(unlabelled revision)"}${
            str(future["ampacity_amps"]) ? ` at ${str(future["ampacity_amps"])} A` : ""
          }. It is stored for analysis only and is not evaluated as energized.`,
      });
    }
  }

  const byIntertie = groupByParent(input.intertieConfigs ?? [], "intertie_uuid");
  for (const tie of input.interties ?? []) {
    const uuid = str(tie["id"]);
    const tid = str(tie["intertie_id"]) || uuid;
    const idCheck = checkIntertieId(tid);
    if (!idCheck.ok) {
      findings.push({ code: "intertie_id_format", severity: "error", serviceId: tid, message: idCheck.error! });
    }
    const configs = byIntertie.get(uuid) ?? [];
    const current = currentIntertieConfiguration(configs);
    if (!current) {
      findings.push({
        code: "intertie_not_energized",
        severity: "info",
        serviceId: tid,
        message: `${tid} has no commissioned arrangement yet — ${configs.length} design revision(s) stored. Current-state QA does not treat it as energized.`,
      });
      continue;
    }
    const a = str(current["endpoint_a_service_uuid"]) || str(current["endpoint_a_ref"]);
    const b = str(current["endpoint_b_service_uuid"]) || str(current["endpoint_b_ref"]);
    if (a && b && a === b) {
      findings.push({
        code: "intertie_endpoints_identical",
        severity: "error",
        serviceId: tid,
        message: `${tid} names the same service on both ends of the current arrangement.`,
      });
    }
    if (!str(current["transfer_method"]) || !str(current["normal_state"])) {
      findings.push({
        code: "intertie_configuration_incomplete",
        severity: "warning",
        serviceId: tid,
        message: `${tid} is energized but its transfer/isolation method or normal operating state is not recorded.`,
      });
    }
  }

  return findings;
}
