// FARMOPS-ELEC-SWITCH-CONTROL-V1 — first-class switching and control topology.
//
// Pure, side-effect free domain module. It models what FarmOps previously had no
// representation for: the physical enclosure that holds switching devices, the
// individual switching devices, the logical group of devices that operate the
// same target(s), the controlled targets, and the physical wiring segments that
// carry line, switched, traveler, grounded, equipment grounding or control
// conductors between panelboards, junction boxes, switch banks and loads.
//
// Hard rules encoded here:
//   * a switching device is NOT a load and is never counted as one;
//   * a control group is NOT a circuit group — the cable between two 3-way
//     switches stays a wiring segment inside the supplying branch circuit;
//   * conductor function is never inferred from insulation colour, tape or a
//     band; markings are stored as observed evidence until traced or tested;
//   * a wall switch is not a disconnecting means until explicitly verified;
//   * raceway or cable presence never advances a device, control group or
//     target past planned;
//   * stable IDs (SWB-*, SW-*, CTL-*) are permanent and never encode location,
//     circuit assignment or controlled target.
import type { FieldOwnership, SnapshotRecord, SnapshotValue } from "@/lib/electrical-snapshot";

export const SWITCH_CONTROL_MODEL_VERSION = "FARMOPS-ELEC-SWITCH-CONTROL-V1";

/* ------------------------------------------------------------------ *
 * Stable identity
 * ------------------------------------------------------------------ */

export const SWITCH_BANK_ID_RE = /^SWB-[A-Z]{2,6}-\d{3}$/;
export const SWITCH_DEVICE_ID_RE = /^SW-[A-Z]{2,6}-\d{3}$/;
export const CONTROL_GROUP_ID_RE = /^CTL-[A-Z]{2,6}-\d{3}$/;

export const switchBankId = (site: string, n: number) =>
  `SWB-${site.trim().toUpperCase()}-${String(n).padStart(3, "0")}`;
export const switchDeviceId = (site: string, n: number) =>
  `SW-${site.trim().toUpperCase()}-${String(n).padStart(3, "0")}`;
export const controlGroupId = (site: string, n: number) =>
  `CTL-${site.trim().toUpperCase()}-${String(n).padStart(3, "0")}`;

export type SwitchControlKind =
  | "switch_bank"
  | "switch_device"
  | "control_group"
  | "control_target"
  | "control_wiring_segment";

export function checkSwitchControlId(
  kind: "switch_bank" | "switch_device" | "control_group",
  id: string,
): { ok: boolean; error?: string } {
  const value = (id ?? "").trim().toUpperCase();
  const re =
    kind === "switch_bank"
      ? SWITCH_BANK_ID_RE
      : kind === "switch_device"
        ? SWITCH_DEVICE_ID_RE
        : CONTROL_GROUP_ID_RE;
  if (re.test(value)) return { ok: true };
  const shape =
    kind === "switch_bank"
      ? "SWB-<site>-###"
      : kind === "switch_device"
        ? "SW-<site>-###"
        : "CTL-<site>-###";
  return { ok: false, error: `${id} is not a canonical ${shape} identifier.` };
}

/* ------------------------------------------------------------------ *
 * Recognized switching devices and control arrangements
 * ------------------------------------------------------------------ */

export interface SwitchTypeEntry {
  value: string;
  label: string;
  /** Poles the device switches, when the type fixes it. */
  poles: number | null;
  plain: string;
}

export const SWITCH_TYPES: readonly SwitchTypeEntry[] = [
  {
    value: "single_pole",
    label: "Single-pole switch",
    poles: 1,
    plain: "Controls one ungrounded conductor from a single location.",
  },
  {
    value: "double_pole",
    label: "Double-pole switch",
    poles: 2,
    plain: "Switches two ungrounded conductors together from a single location.",
  },
  {
    value: "three_way",
    label: "3-way switch",
    poles: 1,
    plain:
      "Endpoint device of a two-location or multi-location arrangement. Two 3-way switches are " +
      "connected to each other by traveler conductors.",
  },
  {
    value: "four_way",
    label: "4-way switch",
    poles: 1,
    plain:
      "Intermediate device between two 3-way switches. It transposes the traveler conductors, " +
      "adding another control location.",
  },
  {
    value: "dimmer",
    label: "Dimmer",
    poles: 1,
    plain: "Varies output to the controlled utilization equipment. May be single-location or 3-way.",
  },
  {
    value: "selector",
    label: "Selector switch",
    poles: null,
    plain: "Selects between two or more outputs or modes.",
  },
  {
    value: "momentary",
    label: "Momentary switch",
    poles: null,
    plain: "Returns to rest position when released; usually operates a relay or contactor.",
  },
  { value: "keyed", label: "Keyed switch", poles: null, plain: "Operation requires a key." },
  {
    value: "pilot_light",
    label: "Switch with pilot light",
    poles: 1,
    plain: "Switch with an indicator showing the controlled equipment is energized.",
  },
  {
    value: "occupancy_sensor",
    label: "Occupancy sensor switch",
    poles: null,
    plain: "Automatic control device that switches on presence detection.",
  },
  { value: "other", label: "Other switching device", poles: null, plain: "Recorded type not listed." },
  {
    value: "unknown",
    label: "Unknown",
    poles: null,
    plain: "Not yet observed. Never guessed from the enclosure or the circuit.",
  },
];

export const SWITCH_TYPE_VALUES = SWITCH_TYPES.map((t) => t.value);

export interface ControlMethodEntry {
  value: string;
  label: string;
  plain: string;
  /** Endpoint 3-way device count a complete arrangement of this kind needs. */
  expectedEndpoints: number | null;
  allowsIntermediate: boolean;
}

export const CONTROL_METHODS: readonly ControlMethodEntry[] = [
  {
    value: "single_location",
    label: "Single-location control",
    plain: "One switching device operates the target.",
    expectedEndpoints: 1,
    allowsIntermediate: false,
  },
  {
    value: "two_location_three_way",
    label: "Two-location control (two 3-way switches)",
    plain:
      "Two 3-way switches in one control group operate the same target from two locations, " +
      "connected to each other by traveler conductors.",
    expectedEndpoints: 2,
    allowsIntermediate: false,
  },
  {
    value: "multi_location_three_and_four_way",
    label: "Multi-location control (two 3-way switches plus 4-way intermediates)",
    plain:
      "Two endpoint 3-way switches with one or more intermediate 4-way switches, all in the same " +
      "control group.",
    expectedEndpoints: 2,
    allowsIntermediate: true,
  },
  {
    value: "dimming",
    label: "Dimming control",
    plain: "One or more dimmers operate the target.",
    expectedEndpoints: null,
    allowsIntermediate: false,
  },
  {
    value: "selector",
    label: "Selector control",
    plain: "A selector device chooses between outputs or modes.",
    expectedEndpoints: null,
    allowsIntermediate: false,
  },
  {
    value: "automatic_sensor",
    label: "Automatic (sensor) control",
    plain: "An automatic control device operates the target.",
    expectedEndpoints: null,
    allowsIntermediate: false,
  },
  {
    value: "relay_or_contactor",
    label: "Relay or contactor control",
    plain: "Switching devices operate a relay or contactor that carries the load current.",
    expectedEndpoints: null,
    allowsIntermediate: true,
  },
  {
    value: "unknown",
    label: "Unknown arrangement",
    plain: "Not yet established by field evidence.",
    expectedEndpoints: null,
    allowsIntermediate: true,
  },
];

export const CONTROL_METHOD_VALUES = CONTROL_METHODS.map((m) => m.value);

/* ------------------------------------------------------------------ *
 * Conductor function
 * ------------------------------------------------------------------ */

export interface ConductorFunctionEntry {
  value: string;
  label: string;
  plain: string;
}

export const CONDUCTOR_FUNCTIONS: readonly ConductorFunctionEntry[] = [
  {
    value: "line_supply",
    label: "Line supply (ungrounded)",
    plain: "The ungrounded supply conductor arriving from the branch-circuit overcurrent device.",
  },
  {
    value: "switched_ungrounded",
    label: "Switched ungrounded conductor",
    plain: "The ungrounded conductor leaving a switching device toward the controlled equipment.",
  },
  {
    value: "traveler",
    label: "Traveler",
    plain:
      "A conductor between 3-way and 4-way switching devices. Travelers belong to the supplying " +
      "branch circuit; they are never a separate circuit.",
  },
  {
    value: "grounded_conductor",
    label: "Grounded conductor (neutral)",
    plain: "The grounded circuit conductor.",
  },
  {
    value: "equipment_grounding_conductor",
    label: "Equipment grounding conductor (EGC)",
    plain: "The conductor that connects non-current-carrying metal parts to ground.",
  },
  {
    value: "control_conductor",
    label: "Control conductor",
    plain: "A conductor operating a relay, contactor or control input rather than the load itself.",
  },
  {
    value: "unknown_unverified",
    label: "Unknown / unverified",
    plain:
      "Function not established. Recorded markings stay evidence only until the conductor is " +
      "traced or tested.",
  },
];

export const CONDUCTOR_FUNCTION_VALUES = CONDUCTOR_FUNCTIONS.map((c) => c.value);

/**
 * Observed markings — coloured insulation, tape, a band — are evidence, never a
 * function. This helper exists so no caller can accidentally translate one.
 */
export function conductorFunctionFromMarking(marking: string | null | undefined): {
  conductor_function: string;
  observed_marking: string | null;
  note: string;
} {
  const observed = (marking ?? "").trim();
  return {
    conductor_function: "unknown_unverified",
    observed_marking: observed || null,
    note: observed
      ? `Marking "${observed}" recorded as observed evidence only. Conductor function stays unverified until the conductor is traced or tested.`
      : "No marking recorded; conductor function stays unverified.",
  };
}

/* ------------------------------------------------------------------ *
 * Lifecycle — every component tracked independently
 * ------------------------------------------------------------------ */

export const SWITCH_LIFECYCLE_STAGES = [
  "planned",
  "material_ready",
  "box_installed",
  "raceway_installed",
  "conductors_installed",
  "device_installed",
  "terminated",
  "function_tested",
  "as_built_verified",
  "removed_abandoned",
] as const;
export type SwitchLifecycleStage = (typeof SWITCH_LIFECYCLE_STAGES)[number];

export const SWITCH_LIFECYCLE_HELP: Record<SwitchLifecycleStage, string> = {
  planned: "Recorded as intended work. Nothing installed.",
  material_ready: "Devices, enclosure or cable on hand. Installation has not started.",
  box_installed: "The device box or enclosure is mounted. No device is installed.",
  raceway_installed: "Raceway is in place. This never means a switching device exists.",
  conductors_installed:
    "Cable or conductors are pulled to the enclosure. Conductor functions may still be unverified.",
  device_installed: "The switching device is physically in the enclosure, not yet terminated.",
  terminated: "Conductors are terminated on the device.",
  function_tested: "Operation was verified by an explicit test.",
  as_built_verified: "An accepted field observation confirms the recorded installation.",
  removed_abandoned: "The object was removed or abandoned in place.",
};

export const COMPONENT_STATES = [
  "not_started",
  "planned",
  "material_ready",
  "installed",
  "terminated",
  "tested",
  "verified",
  "not_applicable",
  "unknown",
] as const;
export type ComponentState = (typeof COMPONENT_STATES)[number];

export const COMPONENT_STATE_LABEL: Record<ComponentState, string> = {
  not_started: "not started",
  planned: "planned",
  material_ready: "material ready",
  installed: "installed",
  terminated: "terminated",
  tested: "tested",
  verified: "verified",
  not_applicable: "not applicable",
  unknown: "unknown",
};

/** Component progress rows shown side by side; never rolled into one number. */
export interface ComponentProgressRow {
  key: string;
  label: string;
  state: ComponentState;
  note?: string;
}

export interface BankComponentInput {
  box_state?: string | null;
  raceway_state?: string | null;
  conductors_state?: string | null;
  devices_state?: string | null;
  termination_state?: string | null;
  function_test_state?: string | null;
  field_verification_status?: string | null;
  conductor_functions_verified?: boolean;
}

const asState = (value: unknown): ComponentState =>
  (COMPONENT_STATES as readonly string[]).includes(String(value ?? ""))
    ? (String(value) as ComponentState)
    : "unknown";

export function bankComponentProgress(input: BankComponentInput): ComponentProgressRow[] {
  const conductors = asState(input.conductors_state);
  return [
    { key: "box", label: "Box or enclosure", state: asState(input.box_state) },
    { key: "raceway", label: "Raceway", state: asState(input.raceway_state) },
    {
      key: "conductors",
      label: "Conductors",
      state: conductors,
      note:
        conductors === "installed" && !input.conductor_functions_verified
          ? "functions unverified"
          : undefined,
    },
    { key: "devices", label: "Switching devices", state: asState(input.devices_state) },
    { key: "termination", label: "Termination", state: asState(input.termination_state) },
    { key: "function_test", label: "Functional test", state: asState(input.function_test_state) },
    {
      key: "verification",
      label: "As-built verification",
      state:
        String(input.field_verification_status ?? "") === "VERIFIED_AS_INSTALLED"
          ? "verified"
          : "not_started",
    },
  ];
}

/**
 * Conservative lifecycle stage for a switch bank. Enclosure, raceway or cable
 * work never advances the bank past the component that was actually observed,
 * and a device is only counted when a device record says so.
 */
export function deriveBankLifecycle(input: BankComponentInput & { installedDeviceCount?: number }): {
  stage: SwitchLifecycleStage;
  reason: string;
} {
  const devices = input.installedDeviceCount ?? 0;
  if (String(input.field_verification_status ?? "") === "VERIFIED_AS_INSTALLED" && devices > 0) {
    return { stage: "as_built_verified", reason: "Accepted field observation with devices installed." };
  }
  if (asState(input.function_test_state) === "tested") {
    return { stage: "function_tested", reason: "Explicit functional test recorded." };
  }
  if (asState(input.termination_state) === "terminated") {
    return { stage: "terminated", reason: "Conductors terminated on installed device(s)." };
  }
  if (devices > 0 || asState(input.devices_state) === "installed") {
    return { stage: "device_installed", reason: "Switching device physically installed." };
  }
  if (asState(input.conductors_state) === "installed") {
    return {
      stage: "conductors_installed",
      reason: "Cable or conductors present. No switching device installed, so the bank stays before device installation.",
    };
  }
  if (asState(input.raceway_state) === "installed") {
    return {
      stage: "raceway_installed",
      reason: "Raceway installed only. Raceway presence never completes a switching device.",
    };
  }
  if (asState(input.box_state) === "installed") {
    return { stage: "box_installed", reason: "Device box or enclosure mounted." };
  }
  if (asState(input.box_state) === "material_ready") {
    return { stage: "material_ready", reason: "Material on hand; installation not started." };
  }
  return { stage: "planned", reason: "Recorded as planned work." };
}

/* ------------------------------------------------------------------ *
 * Model shapes used by validation, diagrams and the UI
 * ------------------------------------------------------------------ */

export interface SwitchBankModel {
  uuid: string;
  stable_id: string;
  description?: string | null;
  building?: string | null;
  grid?: string | null;
  field_grid_reference?: string | null;
  pole_ref?: string | null;
  enclosure_type?: string | null;
  gang_count?: number | null;
  installed_device_count?: number | null;
  lifecycle_status?: string | null;
  supplying_circuit_group_uuid?: string | null;
  source_jbox_uuid?: string | null;
  box_state?: string | null;
  raceway_state?: string | null;
  conductors_state?: string | null;
  devices_state?: string | null;
  termination_state?: string | null;
  function_test_state?: string | null;
  field_verification_status?: string | null;
  evidence?: string | null;
  notes?: string | null;
}

export interface SwitchDeviceModel {
  uuid: string;
  stable_id: string;
  switch_bank_uuid?: string | null;
  gang_position?: number | null;
  switch_type?: string | null;
  poles?: number | null;
  supplying_circuit_group_uuid?: string | null;
  control_group_uuid?: string | null;
  is_disconnecting_means?: boolean | null;
  disconnecting_means_verified?: boolean | null;
  lifecycle_status?: string | null;
  design_only?: boolean | null;
}

export interface ControlGroupModel {
  uuid: string;
  stable_id: string;
  description?: string | null;
  control_method?: string | null;
  expected_device_count?: number | null;
  supplying_circuit_group_uuid?: string | null;
  lifecycle_status?: string | null;
  design_only?: boolean | null;
}

export interface ControlTargetModel {
  uuid: string;
  control_group_uuid: string;
  target_kind?: string | null;
  load_uuid?: string | null;
  device_uuid?: string | null;
  target_ref?: string | null;
}

export interface WiringSegmentModel {
  uuid: string;
  segment_id?: string | null;
  description?: string | null;
  supplying_circuit_group_uuid?: string | null;
  source_switch_bank_uuid?: string | null;
  source_jbox_uuid?: string | null;
  source_panel_uuid?: string | null;
  dest_switch_bank_uuid?: string | null;
  dest_jbox_uuid?: string | null;
  dest_load_uuid?: string | null;
  conductor_function?: string | null;
  observed_marking?: string | null;
  cable_or_raceway_label?: string | null;
}

export interface SwitchControlModel {
  banks: SwitchBankModel[];
  devices: SwitchDeviceModel[];
  groups: ControlGroupModel[];
  targets: ControlTargetModel[];
  segments: WiringSegmentModel[];
  /** Labels for referenced power objects, for diagrams and messages. */
  labels?: {
    circuitGroups?: Record<string, string>;
    junctionBoxes?: Record<string, string>;
    panels?: Record<string, string>;
    loads?: Record<string, string>;
  };
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

export interface SwitchControlFinding {
  code: string;
  severity: "error" | "warning" | "info";
  stable_id: string;
  message: string;
}

/**
 * Structural rules. Incomplete arrangements produce warnings or holds — they
 * never prevent the record from existing.
 */
export function validateSwitchControlModel(model: SwitchControlModel): SwitchControlFinding[] {
  const out: SwitchControlFinding[] = [];
  const deviceById = new Map(model.devices.map((d) => [d.uuid, d]));
  const bankById = new Map(model.banks.map((b) => [b.uuid, b]));

  for (const bank of model.banks) {
    const check = checkSwitchControlId("switch_bank", bank.stable_id);
    if (!check.ok) {
      out.push({
        code: "switch_bank_id_invalid",
        severity: "error",
        stable_id: bank.stable_id,
        message: check.error ?? "Invalid switch-bank identifier.",
      });
    }
    const installed = model.devices.filter(
      (d) => d.switch_bank_uuid === bank.uuid && !d.design_only,
    ).length;
    if ((bank.gang_count ?? 0) > 0 && installed > (bank.gang_count ?? 0)) {
      out.push({
        code: "switch_bank_over_capacity",
        severity: "warning",
        stable_id: bank.stable_id,
        message: `${installed} switching device(s) recorded in a ${bank.gang_count}-gang enclosure.`,
      });
    }
  }

  for (const device of model.devices) {
    const check = checkSwitchControlId("switch_device", device.stable_id);
    if (!check.ok) {
      out.push({
        code: "switch_device_id_invalid",
        severity: "error",
        stable_id: device.stable_id,
        message: check.error ?? "Invalid switching-device identifier.",
      });
    }
    if (device.switch_bank_uuid && !bankById.has(device.switch_bank_uuid)) {
      out.push({
        code: "switch_device_bank_missing",
        severity: "warning",
        stable_id: device.stable_id,
        message: "The switch bank this device references is not in the record.",
      });
    }
    if (device.is_disconnecting_means && !device.disconnecting_means_verified) {
      out.push({
        code: "disconnecting_means_unverified",
        severity: "warning",
        stable_id: device.stable_id,
        message:
          "Marked as a disconnecting means without explicit verification. A wall switch is not classified as a disconnecting means until verified.",
      });
    }
  }

  for (const group of model.groups) {
    const check = checkSwitchControlId("control_group", group.stable_id);
    if (!check.ok) {
      out.push({
        code: "control_group_id_invalid",
        severity: "error",
        stable_id: group.stable_id,
        message: check.error ?? "Invalid control-group identifier.",
      });
    }
    const members = model.devices.filter((d) => d.control_group_uuid === group.uuid);
    const targets = model.targets.filter((t) => t.control_group_uuid === group.uuid);
    const method = CONTROL_METHODS.find((m) => m.value === (group.control_method ?? "unknown"));

    const endpoints = members.filter((m) => m.switch_type === "three_way").length;
    const intermediates = members.filter((m) => m.switch_type === "four_way").length;

    if (method?.expectedEndpoints === 2 && endpoints !== 2) {
      out.push({
        code: "control_group_endpoints_incomplete",
        severity: "warning",
        stable_id: group.stable_id,
        message: `A multi-location arrangement normally has two endpoint 3-way switches; ${endpoints} recorded.`,
      });
    }
    if (intermediates > 0 && !method?.allowsIntermediate) {
      out.push({
        code: "control_group_intermediate_unexpected",
        severity: "warning",
        stable_id: group.stable_id,
        message: `${intermediates} intermediate 4-way switch(es) recorded for a ${method?.label ?? group.control_method} arrangement.`,
      });
    }
    if (!targets.length) {
      out.push({
        code: "control_group_no_target",
        severity: "warning",
        stable_id: group.stable_id,
        message: "No controlled target recorded yet; the target stays an unresolved hold.",
      });
    }
    for (const target of targets) {
      if (target.device_uuid && deviceById.has(target.device_uuid)) {
        const member = deviceById.get(target.device_uuid);
        if (member?.control_group_uuid === group.uuid) {
          out.push({
            code: "control_group_self_reference",
            severity: "error",
            stable_id: group.stable_id,
            message: "A switching device cannot be a controlled target of its own control group.",
          });
        }
      }
    }
    if (
      group.expected_device_count != null &&
      members.length < group.expected_device_count &&
      members.length > 0
    ) {
      out.push({
        code: "control_group_members_missing",
        severity: "warning",
        stable_id: group.stable_id,
        message: `${members.length} of ${group.expected_device_count} expected switching devices recorded.`,
      });
    }
  }

  for (const segment of model.segments) {
    if ((segment.observed_marking ?? "").trim() && segment.conductor_function !== "unknown_unverified") {
      out.push({
        code: "conductor_function_from_marking",
        severity: "warning",
        stable_id: segment.segment_id ?? segment.uuid,
        message:
          "A conductor function is recorded on a segment whose only evidence is a marking. Function must come from tracing or testing, not from colour, tape or a band.",
      });
    }
    if (segment.conductor_function === "traveler" && !segment.supplying_circuit_group_uuid) {
      out.push({
        code: "traveler_without_branch_circuit",
        severity: "warning",
        stable_id: segment.segment_id ?? segment.uuid,
        message:
          "Traveler conductors belong to a supplying branch circuit. Record the supplying circuit group; never create a separate circuit group for travelers.",
      });
    }
  }

  return out.sort(
    (a, b) =>
      a.severity.localeCompare(b.severity) ||
      a.code.localeCompare(b.code) ||
      a.stable_id.localeCompare(b.stable_id),
  );
}

/** A switching device is never a load: this is the assertion used by callers. */
export function switchDevicesExcludedFromLoads(
  loadStableIds: readonly string[],
): SwitchControlFinding[] {
  return loadStableIds
    .filter((id) => SWITCH_DEVICE_ID_RE.test(id.trim().toUpperCase()) || SWITCH_BANK_ID_RE.test(id.trim().toUpperCase()))
    .map((id) => ({
      code: "switch_stored_as_load",
      severity: "error" as const,
      stable_id: id,
      message: "A switching device or switch bank is stored in the load records. A switch is not a load.",
    }));
}

/* ------------------------------------------------------------------ *
 * Diagrams — power path and control path stay separate
 * ------------------------------------------------------------------ */

const mmid = (value: string) => value.replace(/[^A-Za-z0-9]/g, "_");
const mmlabel = (value: string) => value.replace(/"/g, "'");

/** Power path: circuit group → junction box → switch bank → controlled load. */
export function buildPowerPathMermaid(model: SwitchControlModel): string {
  const lines = ["flowchart TD"];
  const seen = new Set<string>();
  const node = (id: string, label: string, shape: "box" | "round" = "box") => {
    const key = mmid(id);
    if (!seen.has(key)) {
      seen.add(key);
      lines.push(
        shape === "round" ? `  ${key}(["${mmlabel(label)}"])` : `  ${key}["${mmlabel(label)}"]`,
      );
    }
    return mmid(id);
  };
  const cgLabel = (uuid: string) => model.labels?.circuitGroups?.[uuid] ?? "Circuit group";
  const jbLabel = (uuid: string) => model.labels?.junctionBoxes?.[uuid] ?? "Junction box";
  const loadLabel = (uuid: string) => model.labels?.loads?.[uuid] ?? "Load";

  for (const bank of model.banks) {
    const bankNode = node(`swb-${bank.uuid}`, `${bank.stable_id} switch bank`);
    if (bank.supplying_circuit_group_uuid) {
      const cg = node(
        `cg-${bank.supplying_circuit_group_uuid}`,
        cgLabel(bank.supplying_circuit_group_uuid),
        "round",
      );
      if (bank.source_jbox_uuid) {
        const jb = node(`jb-${bank.source_jbox_uuid}`, jbLabel(bank.source_jbox_uuid));
        lines.push(`  ${cg} --> ${jb}`);
        lines.push(`  ${jb} --> ${bankNode}`);
      } else {
        lines.push(`  ${cg} --> ${bankNode}`);
      }
    } else if (bank.source_jbox_uuid) {
      const jb = node(`jb-${bank.source_jbox_uuid}`, jbLabel(bank.source_jbox_uuid));
      lines.push(`  ${jb} --> ${bankNode}`);
    }
  }

  for (const segment of model.segments) {
    if (!segment.source_switch_bank_uuid) continue;
    const source = model.banks.find((b) => b.uuid === segment.source_switch_bank_uuid);
    if (!source) continue;
    const sourceNode = node(`swb-${source.uuid}`, `${source.stable_id} switch bank`);
    if (segment.dest_load_uuid) {
      const load = node(`load-${segment.dest_load_uuid}`, loadLabel(segment.dest_load_uuid));
      lines.push(`  ${sourceNode} -->|"switched conductor"| ${load}`);
    }
  }
  return lines.join("\n");
}

/** Control path: switching devices, travelers between banks, controlled targets. */
export function buildControlPathMermaid(model: SwitchControlModel): string {
  const lines = ["flowchart LR"];
  const seen = new Set<string>();
  const node = (id: string, label: string) => {
    const key = mmid(id);
    if (!seen.has(key)) {
      seen.add(key);
      lines.push(`  ${key}["${mmlabel(label)}"]`);
    }
    return key;
  };
  const loadLabel = (uuid: string) => model.labels?.loads?.[uuid] ?? "Controlled target";

  for (const group of model.groups) {
    const groupNode = node(`ctl-${group.uuid}`, `${group.stable_id} control group`);
    for (const device of model.devices.filter((d) => d.control_group_uuid === group.uuid)) {
      const bank = model.banks.find((b) => b.uuid === device.switch_bank_uuid);
      const label = `${device.stable_id}${bank ? ` @ ${bank.stable_id}` : ""}`;
      lines.push(`  ${node(`sw-${device.uuid}`, label)} --- ${groupNode}`);
    }
    for (const target of model.targets.filter((t) => t.control_group_uuid === group.uuid)) {
      const id = target.load_uuid ?? target.device_uuid ?? target.uuid;
      const label = target.load_uuid
        ? loadLabel(target.load_uuid)
        : (target.target_ref ?? "Controlled target");
      lines.push(`  ${groupNode} --> ${node(`tgt-${id}`, label)}`);
    }
  }

  for (const segment of model.segments) {
    const a = model.banks.find((b) => b.uuid === segment.source_switch_bank_uuid);
    const b = model.banks.find((x) => x.uuid === segment.dest_switch_bank_uuid);
    if (!a || !b) continue;
    const label =
      segment.conductor_function === "traveler"
        ? "travelers"
        : segment.conductor_function === "unknown_unverified"
          ? "conductor function unverified"
          : (CONDUCTOR_FUNCTIONS.find((c) => c.value === segment.conductor_function)?.label ??
            "wiring segment");
    lines.push(
      `  ${node(`swb-${a.uuid}`, `${a.stable_id} switch bank`)} <-->|"${mmlabel(label)}"| ${node(
        `swb-${b.uuid}`,
        `${b.stable_id} switch bank`,
      )}`,
    );
  }

  return lines.join("\n");
}

/* ------------------------------------------------------------------ *
 * Snapshot / API projection
 * ------------------------------------------------------------------ */

export type RawRow = Record<string, unknown>;

function scalar(value: unknown): SnapshotValue {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return JSON.stringify(value);
}

function sortKeys(record: SnapshotRecord): SnapshotRecord {
  const out: SnapshotRecord = {};
  for (const key of Object.keys(record).sort()) out[key] = record[key]!;
  return out;
}

const SWITCH_BANK_COLUMNS = [
  "description",
  "building",
  "location_note",
  "grid",
  "field_grid_reference",
  "location_x_ft",
  "location_y_ft",
  "pole_scheme",
  "pole_ref",
  "enclosure_type",
  "gang_count",
  "installed_device_count",
  "supplying_circuit_group_uuid",
  "source_jbox_uuid",
  "lifecycle_status",
  "box_state",
  "raceway_state",
  "conductors_state",
  "devices_state",
  "termination_state",
  "function_test_state",
  "field_verification_status",
  "evidence",
  "notes",
];

const SWITCH_DEVICE_COLUMNS = [
  "description",
  "switch_bank_uuid",
  "gang_position",
  "switch_type",
  "poles",
  "switching_arrangement",
  "rated_voltage",
  "rated_current_amps",
  "supplying_circuit_group_uuid",
  "control_group_uuid",
  "is_disconnecting_means",
  "disconnecting_means_verified",
  "lifecycle_status",
  "device_state",
  "termination_state",
  "function_test_state",
  "field_verification_status",
  "design_only",
  "evidence",
  "notes",
];

const CONTROL_GROUP_COLUMNS = [
  "description",
  "building",
  "control_method",
  "expected_device_count",
  "supplying_circuit_group_uuid",
  "design_only",
  "lifecycle_status",
  "field_verification_status",
  "evidence",
  "notes",
];

const CONTROL_TARGET_COLUMNS = [
  "control_group_uuid",
  "target_kind",
  "load_uuid",
  "device_uuid",
  "target_ref",
  "target_note",
  "design_only",
  "field_verification_status",
  "evidence",
];

const WIRING_SEGMENT_COLUMNS = [
  "segment_id",
  "description",
  "supplying_circuit_group_uuid",
  "raceway_uuid",
  "branch_run_uuid",
  "source_kind",
  "source_switch_bank_uuid",
  "source_jbox_uuid",
  "source_panel_uuid",
  "dest_kind",
  "dest_switch_bank_uuid",
  "dest_jbox_uuid",
  "dest_load_uuid",
  "cable_or_raceway_label",
  "conductor_count",
  "conductor_function",
  "observed_marking",
  "install_state",
  "field_verification_status",
  "evidence",
  "notes",
];

function project(row: RawRow, stableIdColumn: string | null, columns: string[]): SnapshotRecord {
  const record: SnapshotRecord = {
    uuid: scalar(row["id"]),
    stable_id: stableIdColumn ? scalar(row[stableIdColumn]) : null,
    created_at: scalar(row["created_at"]),
    updated_at: scalar(row["updated_at"]),
  };
  for (const column of columns) record[column] = scalar(row[column]);
  return sortKeys(record);
}

export const SWITCH_CONTROL_COLLECTION_COLUMNS = {
  switch_banks: { stableIdColumn: "switch_bank_id", columns: SWITCH_BANK_COLUMNS },
  switch_devices: { stableIdColumn: "switch_device_id", columns: SWITCH_DEVICE_COLUMNS },
  control_groups: { stableIdColumn: "control_group_id", columns: CONTROL_GROUP_COLUMNS },
  control_targets: { stableIdColumn: null, columns: CONTROL_TARGET_COLUMNS },
  control_wiring_segments: { stableIdColumn: "segment_id", columns: WIRING_SEGMENT_COLUMNS },
} as const;

export type SwitchControlCollection = keyof typeof SWITCH_CONTROL_COLLECTION_COLUMNS;

export function buildSwitchControlRecords(
  collection: SwitchControlCollection,
  rows: readonly RawRow[],
): SnapshotRecord[] {
  const spec = SWITCH_CONTROL_COLLECTION_COLUMNS[collection];
  return rows
    .map((row) => project(row, spec.stableIdColumn, [...spec.columns]))
    .sort((a, b) => {
      const sa = String(a["stable_id"] ?? "");
      const sb = String(b["stable_id"] ?? "");
      if (sa !== sb) return sa < sb ? -1 : 1;
      return String(a["uuid"] ?? "") < String(b["uuid"] ?? "") ? -1 : 1;
    });
}

/** Every switch/control field is FarmOps as-built: the workbook has no counterpart. */
export function switchControlOwnership(
  collection: SwitchControlCollection,
): Record<string, FieldOwnership> {
  const spec = SWITCH_CONTROL_COLLECTION_COLUMNS[collection];
  const out: Record<string, FieldOwnership> = {};
  for (const column of spec.columns) out[column] = "farmops_as_built";
  return out;
}
