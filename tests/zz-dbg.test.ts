import { describe, it } from "vitest";
import { numericDiagnostics } from "@/lib/electrical-numeric-diagnostics";
import { runParallelComparison } from "@/lib/electrical-parallel-validation";
import { buildElectricalSnapshot } from "@/lib/electrical-snapshot";
import { ENTITIES } from "@/lib/electrical-entities";
describe("dbg", () => { it("x", () => {
  const rows: any = {}; for (const k of Object.keys(ENTITIES)) rows[k] = [];
  rows.load = [{ id: "1".repeat(8)+"-1111-1111-1111-111111111111", load_id: "FS-034", area: "Farm Shop", description: "Load", volts: 220, amps: 30, connected_va: 6600, updated_at: "2026-08-01T00:00:00.000Z" }];
  const snap = buildElectricalSnapshot({ generatedAt: "2026-08-30T00:00:00.000Z", rows, waypoints: [], breakerPositions: [], panelExits: [], qa: [] });
  const report = runParallelComparison({ odsFileName: "f.ods", odsSha256: "b".repeat(64), comparedAt: "t", sheets: [{ sheet: "Loads", kind: "load", rows: [{ stableId: "FS-034", sourceRow: 12, values: { volts: "240", amps: "30", connected_va: "7200" } }], unmapped: [] }], snapshot: snap });
  console.log("RECORDS", JSON.stringify(report.records.map(r => [r.domain, r.stable_id, r.field, r.ods_value, r.farmops_value, r.ods_row])));
  console.log("FINDINGS", JSON.stringify(numericDiagnostics(report).findings.map(f => [f.stable_id, f.field, f.category, f.ods_value, f.farmops_value])));
}); });
