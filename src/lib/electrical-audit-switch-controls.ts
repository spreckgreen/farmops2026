// Immutable Farm Shop switching/control observation batch, staged after
// FA-FS-2026-09-03-PM-R3-METADATA. It never modifies R2 or R3, and it never
// invents a device count, a conductor function or a controlled target.
//
// Observed in the field:
//   * a switch bank at the northeast man door (grid A8);
//   * a switch bank at the southwest man door (grid E1);
//   * CON-204 reaches the northeast enclosure; CON-107 reaches the southwest one;
//   * two cables run between the two enclosures, one carrying a black-band
//     marking recorded as evidence only;
//   * no switching device is installed in either enclosure.
//
// Everything not established in the field is staged as an explicit hold:
// device counts and types, conductor functions, which conductor is the line
// supply and which is switched, the exact controlled targets, and functional
// operation. The intended multi-location control of the overhead LED lights and
// fans stays design-only.
import type { AuditBatchManifest } from "@/lib/electrical-audit-batch";
import { AUDIT_BATCH_SCHEMA_VERSION } from "@/lib/electrical-audit-batch";

export const FS_SWITCH_CONTROLS_BATCH_ID = "FA-FS-2026-09-05-SWITCH-CONTROLS";

export const FS_SWITCH_BANK_NE_ID = "SWB-FS-001";
export const FS_SWITCH_BANK_SW_ID = "SWB-FS-002";
export const FS_CONTROL_GROUP_ID = "CTL-FS-001";

const EVIDENCE_NE = "Farm Shop walkaround 2026-09-05 — northeast man door enclosure";
const EVIDENCE_SW = "Farm Shop walkaround 2026-09-05 — southwest man door enclosure";
const EVIDENCE_CABLES = "Farm Shop walkaround 2026-09-05 — cables between the two enclosures";

/**
 * The batch is a constant: the manifest fingerprint must never move once the
 * owner has previewed it.
 */
export function buildFsSwitchControlsManifest(): AuditBatchManifest {
  return {
    schema_version: AUDIT_BATCH_SCHEMA_VERSION,
    batch_id: FS_SWITCH_CONTROLS_BATCH_ID,
    title: "Farm Shop switching and control observation",
    scope:
      "Two observed switch-bank enclosures with the cables reaching them. No switching device is installed, so nothing is recorded as controlled or tested.",
    building: "Farm Shop",
    observed_date: "2026-09-05",
    timezone: "America/Denver",
    source: "Field observation",
    evidence: [
      { name: EVIDENCE_NE, subject: FS_SWITCH_BANK_NE_ID },
      { name: EVIDENCE_SW, subject: FS_SWITCH_BANK_SW_ID },
      { name: EVIDENCE_CABLES, subject: "cables between enclosures" },
    ],
    items: [
      {
        item_key: "swb-ne-a8",
        entity_kind: "switch_bank",
        target_stable_id: FS_SWITCH_BANK_NE_ID,
        observation_class: "FIELD_AS_BUILT",
        fields: {
          description: "Northeast man door switch bank",
          building: "Farm Shop",
          location_note: "Northeast man door",
          enclosure_type: "device box",
          box_state: "installed",
          conductors_state: "installed",
          devices_state: "not_started",
          termination_state: "not_started",
          function_test_state: "not_started",
          installed_device_count: 0,
          lifecycle_status: "conductors_installed",
          evidence: EVIDENCE_NE,
          notes:
            "Enclosure mounted with cable present. No switching device installed, so the bank stays before device installation.",
        },
        field_grid_reference: "A8",
        refs: { circuit_group_ref: "CON-204" },
        evidence: EVIDENCE_NE,
      },
      {
        item_key: "swb-sw-e1",
        entity_kind: "switch_bank",
        target_stable_id: FS_SWITCH_BANK_SW_ID,
        observation_class: "FIELD_AS_BUILT",
        fields: {
          description: "Southwest man door switch bank",
          building: "Farm Shop",
          location_note: "Southwest man door",
          enclosure_type: "device box",
          box_state: "installed",
          conductors_state: "installed",
          devices_state: "not_started",
          termination_state: "not_started",
          function_test_state: "not_started",
          installed_device_count: 0,
          lifecycle_status: "conductors_installed",
          evidence: EVIDENCE_SW,
          notes:
            "Enclosure mounted with cable present. No switching device installed, so the bank stays before device installation.",
        },
        field_grid_reference: "E1",
        refs: { circuit_group_ref: "CON-107" },
        evidence: EVIDENCE_SW,
      },
      {
        item_key: "seg-swb-001-002-a",
        entity_kind: "control_wiring_segment",
        target_stable_id: "SEG-FS-SWB001-SWB002-A",
        observation_class: "FIELD_AS_BUILT",
        fields: {
          description: "First cable between the northeast and southwest enclosures",
          cable_or_raceway_label: "cable A",
          conductor_function: "unknown_unverified",
          install_state: "installed",
          evidence: EVIDENCE_CABLES,
          notes:
            "Cable presence observed. Conductor functions stay unverified until each conductor is traced or tested.",
        },
        refs: {
          source_switch_bank_ref: FS_SWITCH_BANK_NE_ID,
          dest_switch_bank_ref: FS_SWITCH_BANK_SW_ID,
        },
        evidence: EVIDENCE_CABLES,
      },
      {
        item_key: "seg-swb-001-002-b",
        entity_kind: "control_wiring_segment",
        target_stable_id: "SEG-FS-SWB001-SWB002-B",
        observation_class: "FIELD_AS_BUILT",
        fields: {
          description: "Second cable between the northeast and southwest enclosures",
          cable_or_raceway_label: "cable B",
          conductor_function: "unknown_unverified",
          observed_marking: "black band on one conductor",
          install_state: "installed",
          evidence: EVIDENCE_CABLES,
          notes:
            "The black band is recorded as observed marking evidence only. A marking never establishes a conductor function.",
        },
        refs: {
          source_switch_bank_ref: FS_SWITCH_BANK_NE_ID,
          dest_switch_bank_ref: FS_SWITCH_BANK_SW_ID,
        },
        evidence: EVIDENCE_CABLES,
      },
      {
        item_key: "ctl-fs-001-intent",
        entity_kind: "control_group",
        target_stable_id: FS_CONTROL_GROUP_ID,
        observation_class: "PLANNED_DESIGN",
        fields: {
          description: "Intended two-location control of the overhead LED lights and fans",
          control_method: "two_location_three_way",
          design_only: true,
          lifecycle_status: "planned",
        },
        refs: {},
        evidence: `${EVIDENCE_NE}; ${EVIDENCE_SW}`,
        reason:
          "Intended arrangement only. It stays design-only until switching devices are installed and their operation is observed.",
      },
      {
        item_key: "hold-device-counts",
        entity_kind: "switch_device",
        target_stable_id: "SW-FS-001",
        observation_class: "HOLD_UNRESOLVED",
        fields: {},
        refs: { switch_bank_ref: FS_SWITCH_BANK_NE_ID },
        evidence: EVIDENCE_NE,
        reason:
          "Exact switching-device count and type per enclosure were not established. No device record is created from an empty enclosure.",
      },
      {
        item_key: "hold-conductor-functions",
        entity_kind: "control_wiring_segment",
        target_stable_id: "SEG-FS-SWB001-SWB002-A",
        observation_class: "HOLD_UNRESOLVED",
        fields: {},
        refs: {},
        evidence: EVIDENCE_CABLES,
        reason:
          "Which conductors are line supply, switched ungrounded, travelers, grounded conductor or equipment grounding conductor was not traced or tested.",
      },
      {
        item_key: "hold-control-targets",
        entity_kind: "control_target",
        target_stable_id: null,
        observation_class: "HOLD_UNRESOLVED",
        fields: {},
        refs: { control_group_ref: FS_CONTROL_GROUP_ID },
        evidence: `${EVIDENCE_NE}; ${EVIDENCE_SW}`,
        reason:
          "The exact controlled utilization equipment was not identified in the field, so no controlled target is recorded.",
      },
      {
        item_key: "hold-functional-operation",
        entity_kind: "control_group",
        target_stable_id: FS_CONTROL_GROUP_ID,
        observation_class: "HOLD_UNRESOLVED",
        fields: {},
        refs: {},
        evidence: `${EVIDENCE_NE}; ${EVIDENCE_SW}`,
        reason:
          "No functional operation was tested. Cable presence never establishes that control works.",
      },
    ],
  } as AuditBatchManifest;
}

export function fsSwitchControlsManifestText(): string {
  return JSON.stringify(buildFsSwitchControlsManifest(), null, 2);
}
