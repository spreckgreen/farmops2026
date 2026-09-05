// Read a building outline out of an uploaded drawing.
//
// Every reader returns candidate outlines in FEET plus the assumptions it had to
// make. Nothing is auto-saved: the person picks the outline and confirms the
// scale. When a file cannot be measured (a PDF page is a picture, not geometry)
// the reader says so instead of inventing dimensions.

import type { PointFt } from "@/lib/site-plan";
import { outlineBounds } from "@/lib/building-grid";

export interface ImportedOutline {
  label: string;
  points: PointFt[];
  lengthFt: number;
  widthFt: number;
  note: string;
}

export interface ImportResult {
  outlines: ImportedOutline[];
  warnings: string[];
  /** True when the file cannot yield measurements and must be traced by hand. */
  needsManualTrace: boolean;
}

const empty = (warnings: string[], needsManualTrace = false): ImportResult => ({
  outlines: [],
  warnings,
  needsManualTrace,
});

function describe(label: string, points: PointFt[], note: string): ImportedOutline | null {
  if (points.length < 3) return null;
  const bounds = outlineBounds(points);
  if (!bounds || bounds.lengthFt <= 0 || bounds.widthFt <= 0) return null;
  return { label, points, lengthFt: bounds.lengthFt, widthFt: bounds.widthFt, note };
}

/** Corner list: JSON array of {x,y} / [x,y], or CSV lines of "x,y" in feet. */
export function parseCornerList(text: string): ImportResult {
  const raw = String(text ?? "").trim();
  if (!raw) return empty(["The corner list is empty."]);

  const points: PointFt[] = [];
  const warnings: string[] = [];

  if (raw.startsWith("[") || raw.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return empty(["That JSON could not be read. Expected a list of corners such as [[0,0],[60,0],[60,40],[0,40]]."]);
    }
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { points?: unknown[] })?.points)
        ? (parsed as { points: unknown[] }).points
        : [];
    for (const item of list) {
      if (Array.isArray(item) && item.length >= 2) {
        points.push({ x: Number(item[0]), y: Number(item[1]) });
      } else if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        points.push({ x: Number(o.x ?? o.X), y: Number(o.y ?? o.Y) });
      }
    }
  } else {
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || /^[a-z_ ]*[a-z]/i.test(trimmed) === false) {
        // fall through to numeric parsing below
      }
      if (!trimmed) continue;
      const parts = trimmed.split(/[,;\t ]+/).filter(Boolean);
      if (parts.length < 2) continue;
      const x = Number(parts[0]);
      const y = Number(parts[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue; // header rows are skipped
      points.push({ x, y });
    }
  }

  const clean = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (clean.length !== points.length) warnings.push("Some rows had non-numeric values and were skipped.");
  if (clean.length < 3) return empty([...warnings, "At least three corners in feet are needed."]);

  const outline = describe("Corner list", clean, `${clean.length} corners read in feet, exactly as given.`);
  return outline ? { outlines: [outline], warnings, needsManualTrace: false } : empty([...warnings, "Those corners do not enclose an area."]);
}

function svgNumbers(text: string): number[] {
  return (text.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number).filter(Number.isFinite);
}

/**
 * SVG: read <polygon>, <polyline> and <rect> shapes plus straight-line <path>
 * outlines. Units are drawing units; the caller supplies feet per unit.
 */
export function parseSvgOutlines(text: string, feetPerUnit: number): ImportResult {
  const svg = String(text ?? "");
  if (!svg.includes("<svg")) return empty(["That file does not look like an SVG drawing."]);
  const scale = Number(feetPerUnit);
  if (!Number.isFinite(scale) || scale <= 0) return empty(["Set how many feet one drawing unit represents."]);

  const warnings: string[] = [];
  const outlines: ImportedOutline[] = [];
  const toFeet = (pts: PointFt[]) =>
    pts.map((p) => ({ x: Number((p.x * scale).toFixed(3)), y: Number((-p.y * scale).toFixed(3)) }));

  for (const match of svg.matchAll(/<(polygon|polyline)[^>]*points="([^"]+)"[^>]*>/gi)) {
    const nums = svgNumbers(match[2]!);
    const pts: PointFt[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i]!, y: nums[i + 1]! });
    const outline = describe(
      `${match[1]!.toLowerCase()} (${pts.length} points)`,
      toFeet(pts),
      `Scaled at ${scale} ft per drawing unit; screen y flipped so north is up.`,
    );
    if (outline) outlines.push(outline);
  }

  for (const match of svg.matchAll(/<rect\b[^>]*>/gi)) {
    const tag = match[0]!;
    const attr = (name: string) => {
      const m = tag.match(new RegExp(`${name}="([^"]+)"`, "i"));
      return m ? Number(m[1]) : Number.NaN;
    };
    const x = attr("x") || 0;
    const y = attr("y") || 0;
    const w = attr("width");
    const h = attr("height");
    if (!Number.isFinite(w) || !Number.isFinite(h)) continue;
    const outline = describe(
      `rect ${w} × ${h} units`,
      toFeet([
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ]),
      `Scaled at ${scale} ft per drawing unit.`,
    );
    if (outline) outlines.push(outline);
  }

  for (const match of svg.matchAll(/<path[^>]*\sd="([^"]+)"[^>]*>/gi)) {
    const d = match[1]!;
    if (/[csqtaCSQTA]/.test(d)) {
      warnings.push("A path with curves was skipped — only straight-line outlines can be measured.");
      continue;
    }
    const nums = svgNumbers(d);
    if (/[mlhvMLHV]/.test(d) === false) continue;
    const pts: PointFt[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i]!, y: nums[i + 1]! });
    const outline = describe(
      `path (${pts.length} points)`,
      toFeet(pts),
      `Straight-line path scaled at ${scale} ft per drawing unit.`,
    );
    if (outline) outlines.push(outline);
  }

  if (outlines.length === 0) {
    warnings.push("No straight-line shapes were found in that SVG.");
  }
  outlines.sort((a, b) => b.lengthFt * b.widthFt - a.lengthFt * a.widthFt);
  return { outlines, warnings, needsManualTrace: false };
}

const DXF_UNIT_FEET: Record<number, number> = {
  1: 1 / 12, // inches
  2: 1, // feet
  4: 1 / 304.8, // millimetres
  5: 1 / 30.48, // centimetres
  6: 1 / 0.3048, // metres
};

/**
 * DXF: read LWPOLYLINE vertices (and closed POLYLINE runs). Curved segments,
 * blocks and external references are reported instead of approximated.
 */
export function parseDxfOutlines(text: string, feetPerUnitOverride?: number | null): ImportResult {
  const dxf = String(text ?? "");
  if (!/\bLWPOLYLINE\b|\bPOLYLINE\b|\$INSUNITS\b/.test(dxf)) {
    return empty(["No polyline outlines were found in that DXF."]);
  }

  const lines = dxf.split(/\r?\n/).map((l) => l.trim());
  let unitsToFeet = Number(feetPerUnitOverride);
  if (!Number.isFinite(unitsToFeet) || unitsToFeet <= 0) {
    unitsToFeet = 1;
    const idx = lines.findIndex((l) => l === "$INSUNITS");
    if (idx >= 0) {
      const code = Number(lines[idx + 2]);
      unitsToFeet = DXF_UNIT_FEET[code] ?? 1;
    }
  }

  const warnings: string[] = [];
  const outlines: ImportedOutline[] = [];
  let current: PointFt[] | null = null;
  let pendingX: number | null = null;
  let sawBulge = false;

  const flush = (label: string) => {
    if (current && current.length >= 3) {
      const scaled = current.map((p) => ({
        x: Number((p.x * unitsToFeet).toFixed(3)),
        y: Number((p.y * unitsToFeet).toFixed(3)),
      }));
      const outline = describe(
        label,
        scaled,
        `${current.length} vertices at ${unitsToFeet.toFixed(4)} ft per drawing unit.`,
      );
      if (outline) outlines.push(outline);
    }
    current = null;
    pendingX = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const code = lines[i];
    const value = lines[i + 1];
    if (code === "0") {
      const entity = value ?? "";
      if (entity === "LWPOLYLINE" || entity === "POLYLINE") {
        flush(`polyline ${outlines.length + 1}`);
        current = [];
      } else if (entity === "SEQEND" || entity === "ENDSEC" || entity === "LINE") {
        flush(`polyline ${outlines.length + 1}`);
      }
      if (entity === "INSERT") {
        warnings.push("A block reference (INSERT) was skipped — its geometry is not measured.");
      }
    } else if (current && code === "10") {
      pendingX = Number(value);
    } else if (current && code === "20" && pendingX !== null) {
      const y = Number(value);
      if (Number.isFinite(pendingX) && Number.isFinite(y)) current.push({ x: pendingX, y });
      pendingX = null;
    } else if (current && code === "42" && Number(value) !== 0) {
      sawBulge = true;
    }
  }
  flush(`polyline ${outlines.length + 1}`);

  if (sawBulge) warnings.push("Curved (bulged) polyline segments were read as straight lines.");
  if (outlines.length === 0) warnings.push("No closed polyline with three or more corners was found.");
  outlines.sort((a, b) => b.lengthFt * b.widthFt - a.lengthFt * a.widthFt);
  return { outlines, warnings, needsManualTrace: false };
}

export function pdfImportGuidance(fileName: string): ImportResult {
  return empty(
    [
      `${fileName} is a page image, so its dimensions cannot be measured automatically.`,
      "Either type the corners in feet, or trace the building on satellite imagery on the Site plan page.",
    ],
    true,
  );
}

export type DrawingKind = "CORNER_LIST" | "SVG" | "DXF" | "PDF" | "UNKNOWN";

export function drawingKind(fileName: string): DrawingKind {
  const name = String(fileName ?? "").toLowerCase();
  if (name.endsWith(".svg")) return "SVG";
  if (name.endsWith(".dxf")) return "DXF";
  if (name.endsWith(".pdf")) return "PDF";
  if (name.endsWith(".csv") || name.endsWith(".json") || name.endsWith(".txt")) return "CORNER_LIST";
  return "UNKNOWN";
}

/** Read whatever the person uploaded, choosing the reader from the file name. */
export function importDrawing(
  fileName: string,
  text: string,
  options: { feetPerUnit?: number | null } = {},
): ImportResult {
  const kind = drawingKind(fileName);
  if (kind === "SVG") return parseSvgOutlines(text, options.feetPerUnit ?? 1);
  if (kind === "DXF") return parseDxfOutlines(text, options.feetPerUnit ?? null);
  if (kind === "PDF") return pdfImportGuidance(fileName);
  if (kind === "CORNER_LIST") return parseCornerList(text);
  return empty([
    `${fileName || "That file"} is not a drawing this page can read. Use a corner list (.csv/.json), an SVG or a DXF.`,
  ]);
}

export function methodForKind(kind: DrawingKind): "CORNER_LIST" | "SVG_IMPORT" | "DXF_IMPORT" {
  if (kind === "SVG") return "SVG_IMPORT";
  if (kind === "DXF") return "DXF_IMPORT";
  return "CORNER_LIST";
}
