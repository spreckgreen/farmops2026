/**
 * Provenance label sheet — part of the premium print package.
 *
 * One label per record, 10-up on letter stock (2" x 4", Avery 5163 geometry),
 * carrying the stable ID, the plot provenance, the precision of that reference
 * and the audit ID behind it. Presentation only: it repeats what the record and
 * the shared location resolver already state, and never promotes a derived
 * centroid, post anchor or interval midpoint to a measured field X/Y.
 */
import { escapeHtml } from "@/lib/print";
import {
  mapSheetModel,
  type MapSheetInput,
  type MapSheetRow,
} from "@/lib/electrical-map-sheet";

/** Avery 5163 geometry: 2 across, 5 down, 2" x 4" labels on letter stock. */
export const PROVENANCE_LABELS_PER_PAGE = 10;

export interface ProvenanceLabel {
  stableId: string;
  kind: string;
  description: string;
  /** "C4 · field-verified grid cell" style reference line. */
  reference: string;
  plotted: string;
  provenance: string;
  provenanceLabel: string;
  precision: string;
  auditId: string;
  conflict: boolean;
}

export interface ProvenanceLabelSheet {
  title: string;
  scopeLabel: string;
  generatedAt: Date;
  labels: ProvenanceLabel[];
  pages: number;
  perPage: number;
  /** Records carrying a conflict notice, counted so the sheet states its own risk. */
  conflictCount: number;
}

function labelFrom(row: MapSheetRow): ProvenanceLabel {
  return {
    stableId: row.stableId,
    kind: row.kind,
    description: row.description,
    reference: row.reference,
    plotted: row.plotted,
    provenance: row.provenance,
    provenanceLabel: row.provenanceLabel,
    precision: row.precision,
    auditId: row.auditId,
    conflict: Boolean(row.conflict),
  };
}

export function provenanceLabelSheet(input: MapSheetInput): ProvenanceLabelSheet {
  const model = mapSheetModel(input);
  const labels = model.rows.map(labelFrom);
  return {
    title: "Electrical provenance label sheet — stable ID, provenance, precision, audit",
    scopeLabel: model.scopeLabel,
    generatedAt: model.generatedAt,
    labels,
    perPage: PROVENANCE_LABELS_PER_PAGE,
    pages: Math.max(1, Math.ceil(labels.length / PROVENANCE_LABELS_PER_PAGE)),
    conflictCount: model.counts.conflicts,
  };
}

export function provenanceLabelFileName(scopeLabel: string, generatedAt = new Date()): string {
  const stamp = generatedAt.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const scope = scopeLabel.replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-|-$/g, "") || "all-panels";
  return `electrical-provenance-labels-${scope}-${stamp}`;
}

/** Printable body HTML for the label sheet, for use with openPrintWindow(). */
export function renderProvenanceLabelsHtml(sheet: ProvenanceLabelSheet): string {
  const esc = escapeHtml;
  const cells = sheet.labels
    .map(
      (l) => `<div class="plabel">
  <div class="pid">${esc(l.stableId)}${l.conflict ? ' <span class="pconflict">CONFLICT</span>' : ""}</div>
  <div class="pkind">${esc(l.kind)}${l.description ? ` — ${esc(l.description)}` : ""}</div>
  <div class="prow"><b>Reference</b> ${esc(l.reference)}</div>
  <div class="prow"><b>Plotted</b> ${esc(l.plotted)}</div>
  <div class="prow"><b>Provenance</b> ${esc(l.provenance)} — ${esc(l.provenanceLabel)}</div>
  <div class="prow"><b>Precision</b> ${esc(l.precision)}</div>
  <div class="prow"><b>Audit</b> ${esc(l.auditId)}</div>
</div>`,
    )
    .join("");

  const body = sheet.labels.length
    ? `<div class="psheet">${cells}</div>`
    : `<div class="empty-note">No records in this scope.</div>`;

  return `<style>
  @page { margin: 0.5in 0.1875in; }
  .psheet { display: grid; grid-template-columns: 4in 4in; gap: 0; }
  .plabel { width: 4in; height: 2in; padding: 0.14in 0.18in; overflow: hidden; page-break-inside: avoid; border: 1px dotted #ccc; }
  .pid { font-size: 15px; font-weight: 700; letter-spacing: 0.02em; }
  .pconflict { font-size: 9px; font-weight: 700; border: 1px solid #111; padding: 0 3px; vertical-align: middle; }
  .pkind { font-size: 10px; color: #444; margin-bottom: 2px; }
  .prow { font-size: 9.5px; line-height: 1.25; }
  .prow b { font-weight: 600; }
  .pnote { font-size: 10px; color: #555; margin-bottom: 8px; }
  @media print { .pnote, .psheet-head { display: none; } .plabel { border: none; } }
</style>
<div class="psheet-head"><header>
  <h1>${esc(sheet.title)}</h1>
  <div class="meta">${esc(sheet.scopeLabel)} · generated ${esc(
    sheet.generatedAt.toISOString().slice(0, 16).replace("T", " "),
  )} UTC · ${sheet.labels.length} label(s) · ${sheet.pages} page(s)</div>
</header>
<div class="pnote">Avery 5163 stock (2" x 4", 10 per page). Print at 100% scale. ${
    sheet.conflictCount
  } record(s) in this scope carry a conflict notice and are marked CONFLICT; see the map sheet for the full notice.</div></div>
${body}`;
}
