/**
 * Map sheet — part of the premium print package.
 *
 * A paper sheet that lists every record in scope with the plot provenance the
 * map drew it from, the precision of that reference, the derivation method, the
 * audit evidence behind it, and any conflict notice the record carries.
 *
 * Presentation only: it never re-derives precedence, never promotes a derived
 * centroid, post anchor or interval midpoint to a measured field X/Y, and never
 * invents a location a record does not state.
 */
import {
  ASSET_KIND_LABEL,
  DEPLOYMENT_SCOPE_NOTICE,
  PLOT_DERIVATION,
  PLOT_PROVENANCE_LABEL,
  PLOT_PROVENANCE_ORDER,
  PRECISION_META,
  fieldVerifiedLocationNotice,
  type OperationalAsset,
  type PlotProvenance,
} from "@/lib/electrical-grid-operational";
import { escapeHtml } from "@/lib/print";

/** Provenance values that state a field-verified reference. */
export const FIELD_VERIFIED_PROVENANCE: PlotProvenance[] = [
  "FIELD_VERIFIED_XY",
  "FIELD_VERIFIED_POST",
  "FIELD_VERIFIED_INTERVAL",
  "FIELD_VERIFIED_GRID_CENTROID",
];

export function isFieldVerifiedProvenance(p: PlotProvenance): boolean {
  return FIELD_VERIFIED_PROVENANCE.includes(p);
}

export interface MapSheetRow {
  stableId: string;
  kind: string;
  description: string;
  reference: string;
  plotted: string;
  provenance: PlotProvenance;
  provenanceLabel: string;
  precision: string;
  derivation: string;
  auditId: string;
  panel: string;
  /** Conflict / disagreement notice carried by the record, verbatim where stated. */
  conflict: string | null;
}

export interface MapSheetModel {
  title: string;
  scopeLabel: string;
  generatedAt: Date;
  filterSummary: string[];
  /** The location-authority notice for this instance. */
  notice: string;
  /** Deployment scope of field audit evidence, stated separately. */
  deploymentNotice: string;
  counts: { total: number; fieldVerified: number; measuredXy: number; conflicts: number };
  provenanceCounts: { provenance: PlotProvenance; label: string; count: number }[];
  rows: MapSheetRow[];
  /** Only the rows carrying a conflict notice, for the notices section. */
  conflicts: MapSheetRow[];
  /** Record gaps reported by the loader, verbatim. */
  gaps: string[];
}

export interface MapSheetInput {
  /** Every record in scope — plotted and unplotted alike. */
  assets: OperationalAsset[];
  /** Human label for the active scope, e.g. "PNL-FS-NW" or "all panels". */
  scopeLabel: string;
  filterSummary?: string[];
  gaps?: string[];
  generatedAt?: Date;
}

function plottedText(a: OperationalAsset): string {
  if (a.plottedXFt == null || a.plottedYFt == null) return "not plotted";
  const point = `${a.plottedXFt} ft E / ${a.plottedYFt} ft S`;
  return a.spanned ? `${point} (span midpoint)` : point;
}

/** The reference the plot came from, preserved as the record states it. */
function referenceText(a: OperationalAsset): string {
  if (a.verifiedReference) return a.verifiedReference;
  if (a.grid) return a.grid;
  if (a.designGrid) return `${a.designGrid} (design)`;
  return "none recorded";
}

/**
 * Conflict notice for one record: the placement disagreement the resolver
 * recorded, plus a field-vs-design grid conflict where the verified reference
 * and the design grid disagree. The verified reference always controls the plot.
 */
export function conflictNoticeFor(a: OperationalAsset): string | null {
  const parts: string[] = [];
  if (a.placementDisagreement) parts.push(a.placementDisagreement);
  if (
    isFieldVerifiedProvenance(a.plotProvenance) &&
    a.designGrid &&
    a.grid &&
    a.designGrid !== a.grid
  )
    parts.push(
      `Design grid ${a.designGrid} conflicts with the field-verified reference ${a.grid}. The field-verified location controls the plot; the design value is retained as DESIGN only.`,
    );
  return parts.length ? parts.join(" ") : null;
}

export function mapSheetModel(input: MapSheetInput): MapSheetModel {
  const generatedAt = input.generatedAt ?? new Date();
  const rows: MapSheetRow[] = input.assets.map((a) => ({
    stableId: a.stableId,
    kind: ASSET_KIND_LABEL[a.kind] ?? a.kind,
    description: a.description ?? "",
    reference: referenceText(a),
    plotted: plottedText(a),
    provenance: a.plotProvenance,
    provenanceLabel: PLOT_PROVENANCE_LABEL[a.plotProvenance],
    precision: PRECISION_META[a.precision].label,
    derivation: a.plotDerivation || PLOT_DERIVATION[a.plotProvenance],
    auditId: a.auditId ?? "not stated",
    panel: a.panel ?? "not in record",
    conflict: conflictNoticeFor(a),
  }));
  rows.sort((x, y) => x.stableId.localeCompare(y.stableId));

  const fieldVerified = rows.filter((r) => isFieldVerifiedProvenance(r.provenance)).length;
  const measuredXy = rows.filter((r) => r.provenance === "FIELD_VERIFIED_XY").length;
  const conflicts = rows.filter((r) => r.conflict);

  return {
    title: "Farm Shop map sheet — record locations, provenance and conflicts",
    scopeLabel: input.scopeLabel,
    generatedAt,
    filterSummary: input.filterSummary ?? [],
    notice: fieldVerifiedLocationNotice({ verified: fieldVerified, measuredXy }),
    deploymentNotice: DEPLOYMENT_SCOPE_NOTICE,
    counts: {
      total: rows.length,
      fieldVerified,
      measuredXy,
      conflicts: conflicts.length,
    },
    provenanceCounts: PLOT_PROVENANCE_ORDER.map((p) => ({
      provenance: p,
      label: PLOT_PROVENANCE_LABEL[p],
      count: rows.filter((r) => r.provenance === p).length,
    })),
    rows,
    conflicts,
    gaps: input.gaps ?? [],
  };
}

/** File-name stamp for a saved or printed map sheet. */
export function mapSheetFileName(scopeLabel: string, generatedAt = new Date()): string {
  const stamp = generatedAt.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const scope = scopeLabel.replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-|-$/g, "") || "all-panels";
  return `farm-shop-map-sheet-${scope}-${stamp}`;
}

/** Printable body HTML for the map sheet, for use with openPrintWindow(). */
export function renderMapSheetHtml(model: MapSheetModel): string {
  const esc = escapeHtml;
  const summaryRows = model.provenanceCounts
    .filter((p) => p.count > 0)
    .map(
      (p) =>
        `<tr><td>${esc(p.provenance)}</td><td>${esc(p.label)}</td><td>${p.count}</td><td>${esc(
          PLOT_DERIVATION[p.provenance],
        )}</td></tr>`,
    )
    .join("");

  const recordRows = model.rows
    .map(
      (r) =>
        `<tr><td>${esc(r.stableId)}</td><td>${esc(r.kind)}</td><td>${esc(r.reference)}</td><td>${esc(
          r.plotted,
        )}</td><td>${esc(r.provenance)}</td><td>${esc(r.precision)}</td><td>${esc(
          r.derivation,
        )}</td><td>${esc(r.auditId)}</td><td>${r.conflict ? "yes" : ""}</td></tr>`,
    )
    .join("");

  const conflictCards = model.conflicts.length
    ? model.conflicts
        .map(
          (r) =>
            `<div class="card"><div class="title">${esc(r.stableId)} — ${esc(
              r.kind,
            )} <span class="badge">${esc(r.provenance)}</span></div><div>${esc(
              r.conflict ?? "",
            )}</div><div class="meta">Plotted ${esc(r.plotted)} · precision ${esc(
              r.precision,
            )} · audit ${esc(r.auditId)}</div></div>`,
        )
        .join("")
    : `<div class="empty-note">No conflict notices in this scope.</div>`;

  const gaps = model.gaps.length
    ? `<h2>Record gaps</h2><ul>${model.gaps.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>`
    : "";

  const filters = model.filterSummary.length
    ? `<h2>Sheet scope</h2><ul>${model.filterSummary
        .map((f) => `<li>${esc(f)}</li>`)
        .join("")}</ul>`
    : "";

  return `<header>
  <h1>${esc(model.title)}</h1>
  <div class="meta">${esc(model.scopeLabel)} · generated ${esc(
    model.generatedAt.toISOString().slice(0, 16).replace("T", " "),
  )} UTC · ${model.counts.total} record(s)</div>
</header>
<h2>Location authority</h2>
<p>${esc(model.notice)}</p>
<p>${esc(model.deploymentNotice)}</p>
<h2>Plot provenance</h2>
<table><thead><tr><th>Provenance</th><th>Meaning</th><th>Records</th><th>Derivation method</th></tr></thead><tbody>${summaryRows}</tbody></table>
${filters}
<h2>Records</h2>
<table><thead><tr><th>Stable ID</th><th>Type</th><th>Reference</th><th>Plotted point</th><th>Provenance</th><th>Precision</th><th>Derivation</th><th>Audit</th><th>Conflict</th></tr></thead><tbody>${recordRows}</tbody></table>
<h2>Conflict notices (${model.counts.conflicts})</h2>
${conflictCards}
${gaps}`;
}
