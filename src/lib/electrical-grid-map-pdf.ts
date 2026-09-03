// Local PDF export for the operational Farm Shop grid map. Presentation only:
// it draws the same plan image and the same plotted dots the screen shows, and
// never derives, snaps or invents a location that the records do not carry.
import { jsPDF } from "jspdf";
import {
  PRECISION_META,
  PRECISION_ORDER,
  type LocationPrecision,
  type OperationalAsset,
} from "@/lib/electrical-grid-operational";
import { AXIS_COLS, AXIS_ROWS } from "@/lib/electrical-grid-map";

/** Dot colours, matched to the Tailwind swatches used on screen. */
const PRECISION_RGB: Record<LocationPrecision, [number, number, number]> = {
  EXACT: [5, 150, 105], // emerald-600
  NEAREST: [2, 132, 199], // sky-600
  INTERVAL: [245, 158, 11], // amber-500
  GRIDLINE: [99, 102, 241], // indigo-500
  NON_FIXED: [168, 85, 247], // purple-500
  UNRESOLVED: [113, 113, 122], // muted foreground
};

/** Plan envelope inside the drawing, measured from the grid corner markers.
 * Identical to the screen overlay so a printed dot lands where the screen dot is. */
const PLAN_PCT = { left: 12.91, right: 86.4, top: 19.52, bottom: 75.97 };

const MARGIN = 36;

export type GridMapPdfInput = {
  /** Records passing the current filters that carry a plottable location. */
  plotted: OperationalAsset[];
  /** Records passing the current filters with no permanent location in the record. */
  unplotted: OperationalAsset[];
  /** Record gaps reported by the loader, verbatim. */
  gaps: string[];
  /** Human label for the active panel filter, e.g. "PNL-FS-NW" or "all panels". */
  panelLabel: string;
  /** Every active filter, written out so the sheet explains its own scope. */
  filterSummary: string[];
  /** Total filtered record count (plotted + unplotted). */
  filteredCount: number;
  /** Imprecise count (INTERVAL + UNRESOLVED) as reported by the loader summary. */
  impreciseCount: number;
  /** Include the data-quality pages, mirroring the remembered print method. */
  includeDataQuality: boolean;
  /** Data URL of the plan drawing. */
  planDataUrl: string;
  /** Natural pixel size of the plan drawing, for aspect ratio. */
  planSize: { width: number; height: number };
  printedAt?: Date;
};

/** Load a bundled image URL as a PNG data URL so jsPDF can embed it. */
export async function loadPlanImage(
  src: string,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`Could not read the grid plan image (${res.status}).`);
  const blob = await res.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not decode the grid plan image."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
  const size = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error("Could not measure the grid plan image."));
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.src = dataUrl;
  });
  return { dataUrl, ...size };
}

/** File name for a saved grid map, stamped with the print date and panel scope. */
export function gridMapPdfFileName(panelLabel: string, printedAt = new Date()): string {
  const stamp = printedAt.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const scope = panelLabel.replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-|-$/g, "") || "all-panels";
  return `farm-shop-grid-map-${scope}-${stamp}.pdf`;
}

export function renderGridMapPdf(input: GridMapPdfInput): jsPDF {
  const printedAt = input.printedAt ?? new Date();
  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: "landscape" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  doc.setProperties({
    title: `Farm Shop grid map — ${input.panelLabel}`,
    subject: "Current FarmOps install locations plotted on the corrected Farm Shop grid",
    creator: "FarmOps",
  });

  doc.setFontSize(13);
  doc.text("Farm Shop grid map — current install locations", MARGIN, MARGIN + 4);
  doc.setFontSize(8);
  doc.setTextColor(90);
  doc.text(
    `Generated ${printedAt.toLocaleString()} (${printedAt.toISOString()}) · ` +
      `${input.plotted.length} of ${input.filteredCount} record(s) plotted · ` +
      `${input.unplotted.length} not mapped` +
      (input.gaps.length ? ` · ${input.gaps.length} record gap(s)` : ""),
    MARGIN,
    MARGIN + 17,
  );
  doc.setFontSize(7);
  doc.text(`Filters — ${input.filterSummary.join(" · ")}`, MARGIN, MARGIN + 27, {
    maxWidth: pageWidth - MARGIN * 2,
  });
  doc.setTextColor(0);

  // Plan: keep the drawing's own aspect ratio so the frozen geometry is intact.
  const top = MARGIN + 36;
  const legendW = 128;
  const availW = pageWidth - MARGIN * 2 - legendW;
  const availH = pageHeight - top - 34;
  const ratio = input.planSize.height / input.planSize.width;
  const planW = Math.min(availW, availH / ratio);
  const planH = planW * ratio;
  const x0 = MARGIN;
  const y0 = top;

  doc.addImage(input.planDataUrl, "PNG", x0, y0, planW, planH);
  doc.setDrawColor(0);
  doc.setLineWidth(0.6);
  doc.rect(x0, y0, planW, planH);

  // Dot placement uses the same plan envelope percentages as the screen overlay.
  const envL = x0 + (PLAN_PCT.left / 100) * planW;
  const envR = x0 + (PLAN_PCT.right / 100) * planW;
  const envT = y0 + (PLAN_PCT.top / 100) * planH;
  const envB = y0 + (PLAN_PCT.bottom / 100) * planH;

  for (const a of input.plotted) {
    if (a.xPct == null || a.yPct == null) continue;
    const cx = envL + (a.xPct / 100) * (envR - envL);
    const cy = envT + (a.yPct / 100) * (envB - envT);
    const [r, g, b] = PRECISION_RGB[a.precision];
    doc.setFillColor(r, g, b);
    doc.setDrawColor(255);
    doc.setLineWidth(0.6);
    if (a.kind === "panel") doc.rect(cx - 3, cy - 3, 6, 6, "FD");
    else doc.circle(cx, cy, 3, "FD");
    // Labels only where the cluster is small enough to stay readable.
    if (a.stackSize <= 4) {
      doc.setFontSize(4.6);
      doc.setTextColor(30);
      const dy = a.stackSize > 1 ? 10 + a.stackIndex * 5 : 1.6;
      doc.text(a.stableId, cx + 4.5, cy + dy);
      doc.setTextColor(0);
    }
  }

  // Legend to the right of the plan.
  let ly = y0 + 10;
  const lx = x0 + planW + 16;
  doc.setFontSize(8);
  doc.text("Location precision", lx, ly);
  ly += 12;
  doc.setFontSize(7);
  for (const p of PRECISION_ORDER) {
    const [r, g, b] = PRECISION_RGB[p];
    doc.setFillColor(r, g, b);
    doc.circle(lx + 3, ly - 2.4, 3, "F");
    doc.text(PRECISION_META[p].label, lx + 10, ly);
    ly += 11;
  }
  ly += 6;
  doc.setFontSize(8);
  doc.text("Shapes", lx, ly);
  ly += 11;
  doc.setFontSize(7);
  doc.text("Square = panel · Circle = load/asset", lx, ly, { maxWidth: legendW - 8 });

  doc.setFontSize(7.5);
  doc.text(
    `${input.plotted.length} of ${input.filteredCount} record(s) plotted · ` +
      `${input.unplotted.length} not mapped (no permanent location in the record)` +
      (input.gaps.length ? ` · ${input.gaps.length} record gap(s)` : ""),
    MARGIN,
    y0 + planH + 16,
  );

  if (input.includeDataQuality) renderDataQuality(doc, input);
  return doc;
}

/** Data-quality detail starts on its own page, as it does when printing. */
function renderDataQuality(doc: jsPDF, input: GridMapPdfInput): void {
  doc.addPage("letter", "portrait");
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const width = pageWidth - MARGIN * 2;
  let y = MARGIN + 4;

  const line = (text: string, size = 8, gap = 11) => {
    doc.setFontSize(size);
    const parts = doc.splitTextToSize(text, width) as string[];
    for (const part of parts) {
      if (y > pageHeight - MARGIN) {
        doc.addPage("letter", "portrait");
        y = MARGIN + 4;
      }
      doc.text(part, MARGIN, y);
      y += gap;
    }
  };

  doc.setFontSize(12);
  doc.text("Data quality", MARGIN, y);
  y += 16;
  doc.setTextColor(90);
  line(
    `Generated ${(input.printedAt ?? new Date()).toLocaleString()} · Filters — ` +
      input.filterSummary.join(" · "),
    7.5,
    10,
  );
  doc.setTextColor(0);
  y += 4;

  line(
    `Rows A–F run north→south at ${AXIS_ROWS.map((r) => r.yFt).join("/")} ft; ` +
      `columns 1–9 run west→east at ${AXIS_COLS.map((c) => c.xFt).join("/")} ft. ` +
      "Interval dots mark a preserved span, not a final install point. Mobile and unresolved " +
      "records are never snapped onto the drawing.",
  );
  y += 4;
  line(
    `${input.unplotted.length} not mapped · ${input.impreciseCount} imprecise · ` +
      `${input.gaps.length} record gap(s)`,
    9,
  );
  y += 6;

  if (input.unplotted.length) {
    line(
      `${input.unplotted.length} record(s) not plotted — no permanent location in the record`,
      9,
    );
    for (const a of input.unplotted) {
      line(
        `${a.stableId} — ${PRECISION_META[a.precision].label}` +
          (a.precisionBasis ? ` — ${a.precisionBasis}` : ""),
        7.5,
        10,
      );
    }
    y += 6;
  }

  if (input.gaps.length) {
    line("Record gaps", 9);
    for (const g of input.gaps) line(g, 7.5, 10);
  }
}
