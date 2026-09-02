import { describe, expect, it } from "vitest";
import {
  connectedVaZeroGateKey,
  isExactNumericZero,
  stillSafeToRemoveConnectedVaZero,
  summarizeConnectedVaZeroGate,
  type ConnectedVaZeroGateRow,
} from "@/lib/electrical-connected-va-zero-gate";

const ok = { ok: true } as const;
const base = {
  authorized: new Set(["FS-010"]),
  ods_state: "blank" as const,
  ods_raw: "",
  zero_origin: "DEFAULTED_OR_COERCED_FROM_BLANK_NULL_OR_TEXT" as const,
  disposition: "ZERO_DEFAULT_OR_COERCION_ARTIFACT" as const,
  newer_evidence: [] as string[],
  baseline: ok,
};

describe("connected_va zero-artifact gate", () => {
  it("clears an unsupported numeric zero", () => {
    expect(
      stillSafeToRemoveConnectedVaZero({ ...base, stable_id: "FS-010", live_connected_va: 0 }),
    ).toEqual({ ok: true });
  });

  it("refuses rows outside the authorized set", () => {
    const r = stillSafeToRemoveConnectedVaZero({
      ...base,
      stable_id: "FS-999",
      live_connected_va: 0,
    });
    expect(r).toMatchObject({ ok: false, status: "not_approved" });
  });

  it("keeps FS-084 out of scope", () => {
    const r = stillSafeToRemoveConnectedVaZero({
      ...base,
      authorized: new Set(["FS-084"]),
      stable_id: "FS-084",
      live_connected_va: 0,
    });
    expect(r).toMatchObject({ ok: false, status: "not_approved" });
  });

  it("reports already_null and drift", () => {
    expect(
      stillSafeToRemoveConnectedVaZero({ ...base, stable_id: "FS-010", live_connected_va: null }),
    ).toMatchObject({ status: "already_null" });
    expect(
      stillSafeToRemoveConnectedVaZero({ ...base, stable_id: "FS-010", live_connected_va: 1500 }),
    ).toMatchObject({ status: "drifted" });
  });

  it("stops when the canonical cell is no longer blank", () => {
    expect(
      stillSafeToRemoveConnectedVaZero({
        ...base,
        stable_id: "FS-010",
        live_connected_va: 0,
        ods_state: "value",
        ods_raw: "1200",
      }),
    ).toMatchObject({ status: "drifted" });
  });

  it("stops on newer evidence or a changed adjudication", () => {
    expect(
      stillSafeToRemoveConnectedVaZero({
        ...base,
        stable_id: "FS-010",
        live_connected_va: 0,
        newer_evidence: ["a source reference has appeared"],
      }),
    ).toMatchObject({ status: "newer_evidence" });
    expect(
      stillSafeToRemoveConnectedVaZero({
        ...base,
        stable_id: "FS-010",
        live_connected_va: 0,
        zero_origin: "EXPLICITLY_ENTERED_FROM_SOURCE_EVIDENCE",
        disposition: "EXPLICIT_ZERO_SUPPORTED",
      }),
    ).toMatchObject({ status: "newer_evidence" });
  });

  it("refuses an unauthorized baseline", () => {
    expect(
      stillSafeToRemoveConnectedVaZero({
        ...base,
        stable_id: "FS-010",
        live_connected_va: 0,
        baseline: { ok: false, reason: "different workbook" },
      }),
    ).toMatchObject({ status: "baseline_blocked" });
  });

  it("treats only exact numeric zero as the artifact value", () => {
    expect(isExactNumericZero(0)).toBe(true);
    expect(isExactNumericZero(null)).toBe(false);
    expect(isExactNumericZero("")).toBe(false);
    expect(isExactNumericZero(0.5)).toBe(false);
  });

  it("reconciles the accounting and flags scope size", () => {
    const row = (status: ConnectedVaZeroGateRow["status"]): ConnectedVaZeroGateRow => ({
      table: "electrical_loads",
      stable_id: `FS-${status}`,
      row_uuid: "u",
      column: "connected_va",
      live_connected_va: 0,
      proposed_value: null,
      ods_state: "blank",
      ods_raw: "",
      ods_worksheet: "Loads",
      ods_row: 4,
      zero_origin: base.zero_origin,
      disposition: base.disposition,
      provenance: "bulk batch of 11",
      evidence: [],
      status,
      applied_at: null,
      baseline_ods_file: "PremoFarmElectrical.ods",
      baseline_sha256: "sha",
      });
    const rows = [row("would_change"), row("already_null"), row("drifted")];
    const s = summarizeConnectedVaZeroGate(rows, {
      authorized_rows: 11,
      baseline_ods_file: "PremoFarmElectrical.ods",
      baseline_sha256: "sha",
      baseline_authorized: true,
    });
    expect(s.accounted).toBe(3);
    expect(s.reconciles).toBe(true);
    expect(s.matches_reviewed_scope).toBe(true);
    expect(connectedVaZeroGateKey({ table: "electrical_loads", stable_id: "FS-010" })).toBe(
      "electrical_loads|FS-010|connected_va",
    );
  });
});
