// Temporary QA harness: renders the three electrical PDFs from a synthetic
// bundle so the layouts can be inspected without a live session.
import { writeFileSync } from "node:fs";
import {
  buildGridMapModel,
  buildLabelModel,
  buildSheetModel,
  DEFAULT_SCOPE,
  type DocumentBundle,
} from "../src/lib/electrical-documents";
import { buildVersionStamp } from "../src/lib/electrical-doc-version";
import { renderGridMapPdf, renderLabelsPdf, renderSheetPdf } from "../src/lib/electrical-pdf";

const rows = 46;
const loads = Array.from({ length: rows }, (_, i) => ({
  uuid: `u-load-${i}`,
  stable_id: `FS-${String(i + 1).padStart(3, "0")}`,
  area: "Farm Shop",
  location: i % 5 === 0 ? "" : "North wall bay",
  grid: i % 7 === 0 ? "" : `${"ABCDEF"[i % 6]}${(i % 9) + 1}`,
  description:
    i % 3 === 0
      ? "Mini split condenser — outdoor unit, long descriptive text to test wrapping in the printed table"
      : `Receptacle circuit ${i + 1}`,
  volts: i % 4 === 0 ? 240 : 120,
  amps: i % 6 === 0 ? 50 : 20,
  connected_va: i % 5 === 0 ? null : 1800,
  dedicated_shared: i % 3 === 0 ? "Dedicated" : i % 3 === 1 ? "Shared" : "TBD",
  critical: i % 8 === 0,
  install_status: i % 2 === 0 ? "planned" : "installed",
  circuit_group_stable_id: i % 4 === 0 ? "CON-001" : "",
  suggested_panel: i % 5 === 0 ? "PNL-FS-NW" : "",
}));

const bundle: DocumentBundle = {
  schema_version: "1.4",
  generated_at: "2026-09-03T12:00:00.000Z",
  manifest: [],
  qa: {
    errors: 2,
    warnings: 3,
    findings: [
      { code: "LOAD_NO_PANEL", severity: "error", stable_id: "FS-013", message: "No proven panel relationship in the record; Suggested Panel is empty." },
      { code: "GRID_MISSING", severity: "warning", stable_id: "FS-008", message: "No grid reference recorded, so the load cannot be plotted on the Farm Shop plan." },
    ],
  },
  counts: {},
  snapshot: {
    schema_version: "1.4",
    generated_at: "2026-09-03T12:00:00.000Z",
    loads: loads as never,
    panels: [
      { uuid: "u-p1", stable_id: "PNL-FS-NW", description: "Farm Shop north-west sub panel", building: "Farm Shop", grid: "A1", voltage: 240, bus_rating_amps: 200, spaces: 42, feeder_source: "PNL-MAIN" },
      { uuid: "u-p2", stable_id: "PNL-FS-NE", description: "Farm Shop north-east sub panel", building: "Farm Shop", grid: "A9", voltage: 240, bus_rating_amps: 100, spaces: 24, feeder_source: null },
    ] as never,
    circuit_groups: [
      { uuid: "u-c1", stable_id: "CON-001", description: "Shop receptacles", panel_stable_id: "PNL-FS-NW", breaker_position: "12", voltage: 120, circuit_rating_amps: 20, conductor_size: "12 AWG Cu" },
    ] as never,
    feeders: [
      { uuid: "u-f1", stable_id: "FDR-001", description: "Main to Farm Shop", source_endpoint_ref: "PNL-MAIN", dest_endpoint_ref: "PNL-FS-NW", voltage: 240, ampacity_amps: 200, conductor_size: "4/0 Al" },
    ] as never,
    panel_breaker_positions: [] as never,
  },
};

const models = {
  sheet: buildSheetModel(bundle, DEFAULT_SCOPE),
  labels: buildLabelModel(bundle, ["load", "panel"], DEFAULT_SCOPE),
  map: buildGridMapModel(bundle, DEFAULT_SCOPE),
};

const base = {
  apiVersion: "v1",
  schemaVersion: bundle.schema_version,
  generatedAt: bundle.generated_at,
  qaErrors: bundle.qa.errors,
  qaWarnings: bundle.qa.warnings,
  generatedBy: "qa@example.com",
  printedAt: new Date().toISOString(),
  scope: "Farm Shop / all panels",
};

const sheetStamp = await buildVersionStamp({ ...base, docType: "farm-shop-sheet", counts: models.sheet.counts }, models.sheet.digestSource);
const labelStamp = await buildVersionStamp({ ...base, docType: "avery-labels", counts: { labels: models.labels.total } }, models.labels.digestSource);
const mapStamp = await buildVersionStamp({ ...base, docType: "grid-map", counts: { total: models.map.summary.total } }, models.map.digestSource);

const out = (name: string, doc: { output: (t: string) => unknown }) => {
  const buf = Buffer.from(doc.output("arraybuffer") as ArrayBuffer);
  writeFileSync(`/tmp/qa/${name}.pdf`, buf);
  console.log(name, buf.length, "bytes");
};

out("sheet", renderSheetPdf(models.sheet, sheetStamp));
out("labels", renderLabelsPdf(models.labels, labelStamp));
out("map", renderGridMapPdf(models.map, mapStamp));
console.log("labels groups", models.labels.groups.map((g) => `${g.location}/${g.panel}:${g.records.length}`));
console.log("map summary", models.map.summary, "unplaced", models.map.unplaced.length);
