// Owner-scoped read of the switching and control topology. Read-only: no write
// scope is added here, and nothing is derived that the records do not state.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import type { SwitchControlModel } from "@/lib/electrical-switch-controls";

type Row = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseDb = { from: (table: string) => any };
const s = (v: unknown) => (v == null ? null : String(v));
const n = (v: unknown) => (v == null || v === "" ? null : Number(v));

export const loadSwitchControlModel = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SwitchControlModel> => {
    await requireElectricalAccess(context.supabase, context.userId, "read");
    const db = context.supabase as unknown as LooseDb;

    const read = async (table: string): Promise<Row[]> => {
      const { data, error } = await db.from(table).select("*");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    };

    const [banks, devices, groups, targets, segments, circuitGroups, jboxes, panels, loads] =
      await Promise.all([
        read("electrical_switch_banks"),
        read("electrical_switch_devices"),
        read("electrical_control_groups"),
        read("electrical_control_targets"),
        read("electrical_control_wiring_segments"),
        read("electrical_circuit_groups"),
        read("electrical_junction_boxes"),
        read("electrical_panels"),
        read("electrical_loads"),
      ]);

    const label = (rows: Row[], idColumn: string) =>
      Object.fromEntries(
        rows.map((r) => [String(r["id"]), s(r[idColumn]) ?? String(r["id"])]),
      ) as Record<string, string>;

    return {
      banks: banks.map((r) => ({
        uuid: String(r["id"]),
        stable_id: s(r["switch_bank_id"]) ?? "",
        description: s(r["description"]),
        building: s(r["building"]),
        grid: s(r["grid"]),
        field_grid_reference: s(r["field_grid_reference"]),
        pole_ref: s(r["pole_ref"]),
        enclosure_type: s(r["enclosure_type"]),
        gang_count: n(r["gang_count"]),
        installed_device_count: n(r["installed_device_count"]),
        lifecycle_status: s(r["lifecycle_status"]),
        supplying_circuit_group_uuid: s(r["supplying_circuit_group_uuid"]),
        source_jbox_uuid: s(r["source_jbox_uuid"]),
        box_state: s(r["box_state"]),
        raceway_state: s(r["raceway_state"]),
        conductors_state: s(r["conductors_state"]),
        devices_state: s(r["devices_state"]),
        termination_state: s(r["termination_state"]),
        function_test_state: s(r["function_test_state"]),
        field_verification_status: s(r["field_verification_status"]),
        evidence: s(r["evidence"]),
        notes: s(r["notes"]),
      })),
      devices: devices.map((r) => ({
        uuid: String(r["id"]),
        stable_id: s(r["switch_device_id"]) ?? "",
        switch_bank_uuid: s(r["switch_bank_uuid"]),
        gang_position: n(r["gang_position"]),
        switch_type: s(r["switch_type"]),
        poles: n(r["poles"]),
        supplying_circuit_group_uuid: s(r["supplying_circuit_group_uuid"]),
        control_group_uuid: s(r["control_group_uuid"]),
        is_disconnecting_means: r["is_disconnecting_means"] === true,
        disconnecting_means_verified: r["disconnecting_means_verified"] === true,
        lifecycle_status: s(r["lifecycle_status"]),
        design_only: r["design_only"] === true,
      })),
      groups: groups.map((r) => ({
        uuid: String(r["id"]),
        stable_id: s(r["control_group_id"]) ?? "",
        description: s(r["description"]),
        control_method: s(r["control_method"]),
        expected_device_count: n(r["expected_device_count"]),
        supplying_circuit_group_uuid: s(r["supplying_circuit_group_uuid"]),
        lifecycle_status: s(r["lifecycle_status"]),
        design_only: r["design_only"] === true,
      })),
      targets: targets.map((r) => ({
        uuid: String(r["id"]),
        control_group_uuid: String(r["control_group_uuid"] ?? ""),
        target_kind: s(r["target_kind"]),
        load_uuid: s(r["load_uuid"]),
        device_uuid: s(r["device_uuid"]),
        target_ref: s(r["target_ref"]),
      })),
      segments: segments.map((r) => ({
        uuid: String(r["id"]),
        segment_id: s(r["segment_id"]),
        description: s(r["description"]),
        supplying_circuit_group_uuid: s(r["supplying_circuit_group_uuid"]),
        source_switch_bank_uuid: s(r["source_switch_bank_uuid"]),
        source_jbox_uuid: s(r["source_jbox_uuid"]),
        source_panel_uuid: s(r["source_panel_uuid"]),
        dest_switch_bank_uuid: s(r["dest_switch_bank_uuid"]),
        dest_jbox_uuid: s(r["dest_jbox_uuid"]),
        dest_load_uuid: s(r["dest_load_uuid"]),
        conductor_function: s(r["conductor_function"]),
        observed_marking: s(r["observed_marking"]),
        cable_or_raceway_label: s(r["cable_or_raceway_label"]),
      })),
      labels: {
        circuitGroups: label(circuitGroups, "circuit_group_id"),
        junctionBoxes: label(jboxes, "jbox_id"),
        panels: label(panels, "panel_id"),
        loads: label(loads, "load_id"),
      },
    };
  });
