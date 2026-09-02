import { describe, expect, it } from "vitest";
import {
  traceFs084AmpProvenance,
  fs084TraceCsv,
  fs084ProvenanceMarkdown,
  FS084_STABLE_ID,
  type Fs084FarmOpsProvenance,
} from "@/lib/electrical-fs084-amp-provenance";
import {
  makeAdjudicationBaseline,
  PHASE_44A_BASELINE_SHA256,
  PHASE_44A_BASELINE_ODS_FILE,
} from "@/lib/electrical-adjudication-baseline";

const sheets = [
  {
    name: "Loads",
    rows: [
      ["Load ID", "Description", "Volts", "Amps", "Connected VA"],
      ["FS-082", "Bryant ductless", "120", "0", "0"],
      ["FS-083", "Bryant ductless", "120", "0", "0"],
      ["FS-084", "Bryant ductless", "240", "60", "14400"],
    ],
  },
];

function baseline(sha = PHASE_44A_BASELINE_SHA256) {
  return makeAdjudicationBaseline({
    ods_file_name: PHASE_44A_BASELINE_ODS_FILE,
    ods_sha256: sha,
    sheets: sheets as never,
  });
}

const bare: Fs084FarmOpsProvenance = {
  load_id: "FS-084",
  uuid: "u1",
  amps: 25,
  volts: 240,
  connected_va: null,
  demand_va: null,
  demand_basis: null,
  notes: null,
  source_reference: null,
  source_circuit: null,
  circuit_group_ref: null,
  equipment_model: null,
  ods_extras: null,
  created_at: "2026-08-29T01:44:02.000Z",
  updated_at: null,
  creation_batch_size: 240,
  amps_audit_entries: 0,
  breaker_links: [],
  circuit_links: [],
  import_snapshot: false,
};

describe("FS-084 amp provenance trace", () => {
  it("classifies the canonical 60 A as a legacy value of unknown source", () => {
    const r = traceFs084AmpProvenance({ baseline: baseline(), provenance: [bare] })!;
    expect(r.stable_id).toBe(FS084_STABLE_ID);
    expect(r.ods_amps).toBe(60);
    expect(r.ods_amp_class).toBe("LEGACY_VALUE_SOURCE_UNKNOWN");
    expect(r.ods_amp_provenance_strength).toBe("NONE");
  });

  it("excludes the derived 14,400 VA as evidence", () => {
    const r = traceFs084AmpProvenance({ baseline: baseline(), provenance: [bare] })!;
    expect(r.va_basis).toBe("derived_volts_times_amps");
    expect(r.va_excluded_as_evidence).toBe(true);
    const vaRow = r.trace.find((t) => t.value === "14400")!;
    expect(vaRow.independent_evidence).toBe(false);
  });

  it("does not conclude 25 A is MOCP from coincidence alone", () => {
    const r = traceFs084AmpProvenance({ baseline: baseline(), provenance: [bare] })!;
    expect(r.equipment_mocp).toBe(25);
    expect(r.farmops_amp_semantic).toBe("NUMERIC_VALUE_WITH_UNRESOLVED_SEMANTICS");
    expect(r.farmops_amp_semantic_rationale).toMatch(/coincidence is not provenance/i);
  });

  it("reads a linked breaker as installed OCP when one exists", () => {
    const r = traceFs084AmpProvenance({
      baseline: baseline(),
      provenance: [{ ...bare, breaker_links: [{ label: "H1-12", ocp_amps: 25, poles: 2 }] }],
    })!;
    expect(r.farmops_amp_semantic).toBe("ESTABLISHES_INSTALLED_BREAKER_OCP");
  });

  it("never infers MCA and preserves the prior disposition and SHA binding", () => {
    const r = traceFs084AmpProvenance({ baseline: baseline(), provenance: [bare] })!;
    expect(r.mca).toBeNull();
    expect(r.workbook_sha256).toBe(PHASE_44A_BASELINE_SHA256);
    expect(r.is_phase_44a_baseline).toBe(true);
    expect(r.preserved_current_semantic_disposition).toMatch(/CURRENT_SEMANTICS_UNRESOLVED/);
    expect(r.read_only).toBe(true);
    expect(r.farmops_write_authorized).toBe(false);
    expect(r.ods_edit_authorized).toBe(false);
  });

  it("flags a non-baseline workbook and exports both formats", () => {
    const r = traceFs084AmpProvenance({ baseline: baseline("a".repeat(64)), provenance: [bare] })!;
    expect(r.is_phase_44a_baseline).toBe(false);
    expect(fs084TraceCsv(r).split("\n").length).toBeGreaterThan(5);
    expect(fs084ProvenanceMarkdown(r)).toMatch(/FS-084 60 A provenance adjudication/);
  });
});
