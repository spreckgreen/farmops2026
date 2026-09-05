// jsPDF renderers for the three electrical documents. Browser-only: called from
// the document generation screen after the API bundle is in hand.
//
// Every renderer stamps the version block on the cover and repeats the one-line
// version footer on every page, and writes the same version data into the PDF
// metadata — so a cropped or photocopied page still identifies its source.
import { jsPDF } from "jspdf";
import {
  stampFileName,
  stampPdfMetadata,
  type VersionStamp,
} from "@/lib/electrical-doc-version";
import {
  averyCellLines,
  NOT_IN_RECORD,
  type GridMapDocModel,
  type LabelDocModel,
  type SheetModel,
} from "@/lib/electrical-documents";
import { AXIS_COLS, AXIS_ROWS, SHOP_DEPTH_FT, SHOP_WIDTH_FT, type CircuitClass } from "@/lib/electrical-grid-map";
import { PLAN_ASPECT_RATIO, PLAN_BUILDING_FRACTION } from "@/lib/electrical-grid-plan-geometry";
import { LABEL_FORMATS } from "@/components/electrical/panel-qr-label";

const PT_PER_IN = 72;
const MARGIN = 36;

/** Dot colours match the on-screen grid map legend. */
const CLASS_RGB: Record<CircuitClass, [number, number, number]> = {
  LARGE_DEDICATED: [200, 30, 30],
  DEDICATED_20A: [225, 130, 20],
  SHARED: [30, 90, 200],
  UNCLASSIFIED: [130, 130, 130],
};

const CLASS_LABEL: Record<CircuitClass, string> = {
  LARGE_DEDICATED: "Large dedicated (red)",
  DEDICATED_20A: "Dedicated 20A (orange)",
  SHARED: "Shared (blue)",
  UNCLASSIFIED: "Unclassified — not in record (grey)",
};

function applyMeta(doc: jsPDF, stamp: VersionStamp): void {
  const meta = stampPdfMetadata(stamp);
  doc.setProperties(meta);
}

/** Version footer, drawn on every page after all content is laid out. */
function stampFooters(doc: jsPDF, stamp: VersionStamp): void {
  const pages = doc.getNumberOfPages();
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(90);
    doc.text(stamp.footer, MARGIN, height - 14, { maxWidth: width - MARGIN * 2 - 60 });
    doc.text(`Page ${i} of ${pages}`, width - MARGIN, height - 14, { align: "right" });
    doc.setTextColor(0);
  }
}

/** Cover block: the printed proof of which version of the truth this is. */
function drawStampBlock(doc: jsPDF, stamp: VersionStamp, title: string, y: number): number {
  const width = doc.internal.pageSize.getWidth();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(title, MARGIN, y);
  y += 20;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(`VERSION ${stamp.versionCode}`, MARGIN, y);
  y += 6;
  doc.setDrawColor(160);
  doc.line(MARGIN, y, width - MARGIN, y);
  y += 12;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  for (const line of stamp.lines) {
    const wrapped = doc.splitTextToSize(line, width - MARGIN * 2) as string[];
    for (const w of wrapped) {
      doc.text(w, MARGIN, y);
      y += 10;
    }
  }
  y += 4;
  doc.line(MARGIN, y, width - MARGIN, y);
  return y + 14;
}

/* --------------------------------------------------- Farm Shop sheet (table) */

export function renderSheetPdf(model: SheetModel, stamp: VersionStamp): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: "landscape" });
  applyMeta(doc, stamp);
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const usable = pageWidth - MARGIN * 2;
  const bottom = pageHeight - 34;

  let y = drawStampBlock(doc, stamp, `${model.title} — ${model.scope}`, MARGIN + 10);

  const newPage = () => {
    doc.addPage();
    y = MARGIN + 10;
  };

  for (const section of model.sections) {
    if (y + 60 > bottom) newPage();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(`${section.heading} (${section.rows.length})`, MARGIN, y);
    y += 13;
    if (section.note) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(7.5);
      doc.setTextColor(90);
      for (const w of doc.splitTextToSize(section.note, usable) as string[]) {
        doc.text(w, MARGIN, y);
        y += 9;
      }
      doc.setTextColor(0);
      y += 2;
    }

    if (!section.rows.length) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(`${NOT_IN_RECORD} — no rows in this scope.`, MARGIN, y);
      y += 20;
      continue;
    }

    const weights = section.widths?.length === section.columns.length
      ? section.widths
      : section.columns.map(() => 1);
    const total = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => (w / total) * usable);
    const xs: number[] = [];
    let acc = MARGIN;
    for (const w of widths) {
      xs.push(acc);
      acc += w;
    }

    const header = () => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setFillColor(238, 238, 238);
      doc.rect(MARGIN, y - 8, usable, 13, "F");
      section.columns.forEach((c, i) => doc.text(c, xs[i]! + 2, y));
      y += 13;
      doc.setFont("helvetica", "normal");
    };
    header();

    for (const row of section.rows) {
      const cells = row.map((cell, i) => doc.splitTextToSize(cell, widths[i]! - 4) as string[]);
      const lines = Math.max(...cells.map((c) => c.length));
      const rowHeight = lines * 8.5 + 3;
      if (y + rowHeight > bottom) {
        newPage();
        header();
      }
      doc.setFontSize(7.2);
      cells.forEach((cellLines, i) => {
        cellLines.forEach((line, li) => {
          if (line === NOT_IN_RECORD) doc.setTextColor(150);
          doc.text(line, xs[i]! + 2, y + li * 8.5);
          doc.setTextColor(0);
        });
      });
      y += rowHeight;
      doc.setDrawColor(228);
      doc.line(MARGIN, y - 6, MARGIN + usable, y - 6);
    }
    y += 16;
  }

  stampFooters(doc, stamp);
  return doc;
}

/* ------------------------------------------------------------- Avery labels */

/**
 * Avery 8593 sheet: the same 3 x 10 cell geometry the browser print view uses,
 * so a PDF print and a browser print land in the same physical slots. Each
 * location + panel walk group starts a new sheet.
 */
export function renderLabelsPdf(model: LabelDocModel, stamp: VersionStamp): jsPDF {
  const spec = LABEL_FORMATS["avery-8593"];
  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: "portrait" });
  applyMeta(doc, stamp);
  const pageWidth = doc.internal.pageSize.getWidth();

  // Cover sheet: never a label sheet, so no label slot is consumed by the stamp.
  let y = drawStampBlock(doc, stamp, "Avery 8593 label sheet", MARGIN + 10) + 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(
    `${model.total} labels in ${model.groups.length} print blocks. Each block (location, then panel) starts on a fresh sheet so labels land in the correct slots.`,
    MARGIN,
    y,
    { maxWidth: pageWidth - MARGIN * 2 },
  );
  y += 22;
  for (const g of model.groups) {
    if (y > doc.internal.pageSize.getHeight() - 60) {
      doc.addPage();
      y = MARGIN + 10;
    }
    doc.text(`${g.location} · ${g.panel} — ${g.records.length} labels`, MARGIN, y);
    y += 11;
  }

  const sheetMarginX = 0.19 * PT_PER_IN;
  const sheetMarginY = 0.5 * PT_PER_IN;
  const cellW = (pageWidth - sheetMarginX * 2) / spec.cols;
  const cellH = (doc.internal.pageSize.getHeight() - sheetMarginY * 2) / spec.rows;

  for (const group of model.groups) {
    let slot = 0;
    doc.addPage();
    for (const record of group.records) {
      if (slot > 0 && slot % spec.perPage === 0) doc.addPage();
      const idx = slot % spec.perPage;
      const col = idx % spec.cols;
      const row = Math.floor(idx / spec.cols);
      const x = sheetMarginX + col * cellW;
      const cy = sheetMarginY + row * cellH;

      const { left, right } = averyCellLines(record);
      const rightW = 62;
      const fit = (text: string): string => {
        const lines = doc.splitTextToSize(text, cellW - rightW - 12) as string[];
        const first = lines[0] ?? "";
        return lines.length > 1 ? `${first.trimEnd()}…` : first;
      };
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.text(fit(left[0] ?? ""), x + 6, cy + 16);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.text(fit(left[1] ?? ""), x + 6, cy + 27);
      // Far right column: grid on line 1, volts/amps + D/S on line 2.
      doc.setFontSize(7.5);
      doc.text(right[0] ?? "", x + cellW - 6, cy + 16, { align: "right" });
      doc.text(right[1] ?? "", x + cellW - 6, cy + 27, { align: "right" });
      // Version code, tiny, so a stuck label can still be traced.
      doc.setFontSize(4.6);
      doc.setTextColor(140);
      doc.text(stamp.versionCode, x + cellW - 6, cy + cellH - 5, { align: "right" });
      doc.setTextColor(0);
      slot += 1;
    }
    if (slot === 0) doc.deletePage(doc.getNumberOfPages());
  }

  stampFooters(doc, stamp);
  return doc;
}

/* ----------------------------------------------------------- Grid map plan */

/**
 * The same drawing the screen shows. jsPDF needs pixels in hand, so the caller
 * loads the plan image once and passes it in; without it the plan falls back to
 * plain outline + grid lines rather than printing nothing.
 */
export async function loadPlanImage(): Promise<HTMLImageElement | null> {
  try {
    const src = (await import("@/assets/farm-shop-grid-plan.png")).default as string;
    return await new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  } catch {
    return null;
  }
}

export function renderGridMapPdf(
  model: GridMapDocModel,
  stamp: VersionStamp,
  planImage?: HTMLImageElement | null,
): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: "landscape" });
  applyMeta(doc, stamp);
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  let y = drawStampBlock(doc, stamp, "Farm Shop grid map", MARGIN + 10);

  // Plan area. With the current drawing available, the whole drawing is placed
  // 1:1 in its own aspect ratio and every marker is mapped through the same
  // documented feet→drawing transform the screen uses, so a printed dot sits
  // exactly where the on-screen dot sits. Without it, the frozen 60 x 40 ft
  // outline is drawn instead.
  const availW = pageWidth - MARGIN * 2 - 150;
  const availH = pageHeight - y - 60;
  const drawingAspect = planImage ? PLAN_ASPECT_RATIO : SHOP_WIDTH_FT / SHOP_DEPTH_FT;
  let drawW = availW;
  let drawH = drawW / drawingAspect;
  if (drawH > availH) {
    drawH = availH;
    drawW = drawH * drawingAspect;
  }
  const dx0 = MARGIN + 22;
  const dy0 = y + 14;

  // Building envelope inside the placed drawing — markers are mapped into this.
  const x0 = planImage ? dx0 + PLAN_BUILDING_FRACTION.left * drawW : dx0;
  const y0 = planImage ? dy0 + PLAN_BUILDING_FRACTION.top * drawH : dy0;
  const planW = planImage ? PLAN_BUILDING_FRACTION.width * drawW : drawW;
  const planH = planImage ? PLAN_BUILDING_FRACTION.height * drawH : drawH;

  if (planImage) {
    doc.addImage(planImage, "PNG", dx0, dy0, drawW, drawH);
  } else {
    doc.setDrawColor(60);
    doc.setLineWidth(1);
    doc.rect(x0, y0, planW, planH);
    doc.setLineWidth(0.3);
    doc.setDrawColor(205);
    doc.setFontSize(6.5);
    doc.setTextColor(110);
    for (const col of AXIS_COLS) {
      const cx = x0 + (col.xFt / SHOP_WIDTH_FT) * planW;
      doc.line(cx, y0, cx, y0 + planH);
    }
    for (const row of AXIS_ROWS) {
      const cy = y0 + (row.yFt / SHOP_DEPTH_FT) * planH;
      doc.line(x0, cy, x0 + planW, cy);
    }
  }

  // A1–F9 reference letters and numbers, printed outside the drawing so they
  // never cover it, on both the drawing and the fallback outline.
  doc.setFontSize(6.5);
  doc.setTextColor(110);
  for (const col of AXIS_COLS) {
    const cx = x0 + (col.xFt / SHOP_WIDTH_FT) * planW;
    doc.text(col.label, cx, dy0 - 4, { align: "center" });
  }
  for (const row of AXIS_ROWS) {
    const cy = y0 + (row.yFt / SHOP_DEPTH_FT) * planH;
    doc.text(row.label, dx0 - 8, cy + 2, { align: "right" });
  }
  doc.setTextColor(0);
  doc.setFontSize(7);
  doc.text("North", dx0 + drawW / 2, dy0 - 16, { align: "center" });
  doc.text(`${SHOP_WIDTH_FT} ft west to east`, dx0 + drawW / 2, dy0 + drawH + 14, {
    align: "center",
  });

  // Pole Barn perimeter posts: a second way to read the same plan. A field crew
  // that cannot see a grid cell can still name the nearest painted post.
  doc.setFillColor(70, 70, 70);
  doc.setFontSize(4.2);
  for (const post of model.poles) {
    const px = x0 + (post.xFt / SHOP_WIDTH_FT) * planW;
    const py = y0 + (post.yFt / SHOP_DEPTH_FT) * planH;
    doc.rect(px - 2.1, py - 2.1, 4.2, 4.2, "F");
    doc.setTextColor(70);
    const ox = post.wall === "west" ? -12 : post.wall === "east" ? 5 : -5;
    const oy = post.wall === "north" ? -5 : post.wall === "south" ? 10 : 2;
    doc.text(post.ref, px + ox, py + oy);
    doc.setTextColor(0);
  }
  doc.setFontSize(7);

  for (const p of model.points) {
    if (p.xPct == null || p.yPct == null) continue;
    const cx = x0 + (p.xPct / 100) * planW;
    const cy = y0 + (p.yPct / 100) * planH;
    const [r, g, b] = CLASS_RGB[p.klass];
    doc.setFillColor(r, g, b);
    doc.circle(cx, cy, 3.1, "F");
    // One label per dot, fanned vertically so co-located loads stay readable.
    // A crowded stack prints its IDs in the unplaced/roster list instead of
    // overprinting them on the plan.
    if (p.stackSize <= 4) {
      doc.setFontSize(4.4);
      doc.setTextColor(40);
      // A single dot labels beside itself; a stack drops its labels below the
      // whole cluster so no ID is overprinted by a neighbouring dot.
      const dy = p.stackSize > 1 ? 11 + p.stackIndex * 5.5 : 1.6;
      doc.text(p.loadId, cx + 4.5, cy + dy);
      doc.setTextColor(0);
    }
  }

  // Legend + counts.
  let lx = dx0 + drawW + 22;
  let ly = dy0 + 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text("Legend", lx, ly);
  ly += 12;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  (Object.keys(CLASS_RGB) as CircuitClass[]).forEach((k) => {
    const [r, g, b] = CLASS_RGB[k];
    doc.setFillColor(r, g, b);
    doc.circle(lx + 3, ly - 2, 3, "F");
    doc.text(`${CLASS_LABEL[k]} — ${model.summary.counts[k]}`, lx + 10, ly, { maxWidth: 130 });
    ly += 14;
  });
  doc.setFillColor(70, 70, 70);
  doc.rect(lx + 0.5, ly - 4.5, 5, 5, "F");
  doc.text(`Pole Barn post (${model.poles.length}) — square marker`, lx + 10, ly, { maxWidth: 130 });
  ly += 14;
  doc.text("Grid cells: rows A-F north to south, columns 1-9 west to east.", lx, ly, {
    maxWidth: 140,
  });
  ly += 18;
  doc.text(`Placed: ${model.summary.placed} of ${model.summary.total}`, lx, ly);
  ly += 10;
  doc.text(`Unplaced: ${model.summary.unplaced}`, lx, ly);
  ly += 14;
  doc.setFontSize(6.5);
  doc.setTextColor(90);
  for (const w of doc.splitTextToSize(
    `Panels in scope: ${model.panels.length ? model.panels.join(", ") : NOT_IN_RECORD}`,
    140,
  ) as string[]) {
    doc.text(w, lx, ly);
    ly += 8;
  }
  doc.setTextColor(0);
  void lx;

  // Cross-reference table: every plotted load by grid cell and nearest post, so
  // the sheet can be read from either reference system.
  doc.addPage();
  y = MARGIN + 10;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(`Grid cell and post reference (${model.points.filter((p) => p.xFt != null).length} plotted)`, MARGIN, y);
  y += 14;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.2);
  const refCols: [string, number][] = [
    ["Stable ID", 90],
    ["Description", 230],
    ["Grid cell", 60],
    ["Nearest post", 70],
    ["X ft", 40],
    ["Y ft", 40],
  ];
  const drawRefHeader = () => {
    let cx = MARGIN;
    for (const [head, w] of refCols) {
      doc.text(head, cx, y);
      cx += w;
    }
    y += 10;
    doc.setFont("helvetica", "normal");
  };
  drawRefHeader();
  for (const p of model.points) {
    if (p.xFt == null || p.yFt == null) continue;
    if (y > pageHeight - 44) {
      doc.addPage();
      y = MARGIN + 10;
      doc.setFont("helvetica", "bold");
      drawRefHeader();
    }
    const nearest = model.poles.reduce<{ ref: string; d: number } | null>((best, post) => {
      const d = Math.hypot(post.xFt - p.xFt!, post.yFt - p.yFt!);
      return !best || d < best.d ? { ref: post.ref, d } : best;
    }, null);
    const cells = [
      p.loadId,
      p.description || NOT_IN_RECORD,
      p.gridReference || NOT_IN_RECORD,
      nearest ? `${nearest.ref} (${nearest.d.toFixed(1)} ft)` : NOT_IN_RECORD,
      p.xFt.toFixed(1),
      p.yFt.toFixed(1),
    ];
    let cx = MARGIN;
    cells.forEach((cell, i) => {
      const w = refCols[i]![1];
      const line = (doc.splitTextToSize(cell, w - 4) as string[])[0] ?? "";
      doc.text(line, cx, y);
      cx += w;
    });
    y += 9;
  }

  // Pole Barn post schedule: the frozen perimeter geometry, with its grid cell.
  doc.addPage();
  y = MARGIN + 10;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(`Pole Barn post reference (${model.poles.length} posts)`, MARGIN, y);
  y += 14;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(7.5);
  doc.text(
    `Perimeter post geometry ${model.poleGeometryVersion}, confirmed against the ${SHOP_WIDTH_FT} x ${SHOP_DEPTH_FT} ft outline. Grid cell is looked up from the post position; it never renames the post.`,
    MARGIN,
    y,
    { maxWidth: pageWidth - MARGIN * 2 },
  );
  y += 16;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.2);
  const postCols: [string, number][] = [
    ["Post", 60],
    ["Wall", 60],
    ["Corner", 50],
    ["Grid cell", 60],
    ["X ft", 45],
    ["Y ft", 45],
    ["Basis", 240],
  ];
  const drawPostHeader = () => {
    let cx = MARGIN;
    for (const [head, w] of postCols) {
      doc.text(head, cx, y);
      cx += w;
    }
    y += 10;
    doc.setFont("helvetica", "normal");
  };
  drawPostHeader();
  for (const post of model.poles) {
    if (y > pageHeight - 44) {
      doc.addPage();
      y = MARGIN + 10;
      doc.setFont("helvetica", "bold");
      drawPostHeader();
    }
    const cells = [
      post.ref,
      post.wall,
      post.corner ? "Yes" : "No",
      post.gridCell,
      post.xFt.toFixed(1),
      post.yFt.toFixed(1),
      post.basis,
    ];
    let cx = MARGIN;
    cells.forEach((cell, i) => {
      const w = postCols[i]![1];
      const line = (doc.splitTextToSize(cell, w - 4) as string[])[0] ?? "";
      doc.text(line, cx, y);
      cx += w;
    });
    y += 9;
  }

  // Unplaced loads: listed explicitly rather than dropped or approximated.
  doc.addPage();
  y = MARGIN + 10;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(`Loads not placed on the plan (${model.unplaced.length})`, MARGIN, y);
  y += 14;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(7.5);
  doc.text(
    "No coordinate is estimated. These loads have no usable grid or physical position in the record.",
    MARGIN,
    y,
  );
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  for (const u of model.unplaced) {
    if (y > pageHeight - 44) {
      doc.addPage();
      y = MARGIN + 10;
    }
    const text = `${u.loadId} — ${u.description} — ${u.reason}`;
    for (const w of doc.splitTextToSize(text, pageWidth - MARGIN * 2) as string[]) {
      doc.text(w, MARGIN, y);
      y += 9;
    }
    y += 2;
  }
  if (!model.unplaced.length) doc.text("None — every load in scope is placed.", MARGIN, y);

  stampFooters(doc, stamp);
  return doc;
}

/* -------------------------------------------------------------------- output */

export function savePdf(doc: jsPDF, stamp: VersionStamp): string {
  const name = stampFileName(stamp, "pdf");
  doc.save(name);
  return name;
}

export function pdfObjectUrl(doc: jsPDF): string {
  return doc.output("bloburl") as unknown as string;
}
