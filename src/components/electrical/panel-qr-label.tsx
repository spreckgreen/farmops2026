// Printable panel label: one large QR code plus the details an electrician
// reads at the panel door. The QR encodes the read-only panel sheet URL, e.g.
// https://bostead.lovable.app/electrical/panel/PNL-H1
//
// Three standard print formats are supported (see LABEL_FORMATS):
//   letter-4x2   8.5x11" sheet, 4 columns x 2 rows  (8 labels / page)
//   letter-2x5   8.5x11" sheet, 2 columns x 5 rows  (10 labels / page)
//   label-7676   White 7676 2.99" x 2.99" single label on a label printer
import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { panelLabelLines, panelQrUrl, type PanelLabelSource } from "@/lib/electrical-panel-access";
import { cn } from "@/lib/utils";

export type LabelFormat = "letter-4x2" | "letter-2x5" | "label-7676" | "avery-8593";
/** @deprecated use LabelFormat */
export type QrSize = LabelFormat;

export interface LabelFormatSpec {
  id: LabelFormat;
  name: string;
  /** Print sheet the browser should target. */
  page: { widthIn: number; heightIn: number };
  cols: number;
  rows: number;
  /** Rendered QR module box, in CSS pixels at 96dpi. */
  qrPx: number;
  /** Stack the QR above the text instead of beside it. */
  stacked: boolean;
  perPage: number;
  /**
   * Text-only shortened output: the cell is too small for a scannable QR, so the
   * label carries the stable ID plus one condensed detail line.
   */
  short?: boolean;
}

export const LABEL_FORMATS: Record<LabelFormat, LabelFormatSpec> = {
  "letter-4x2": {
    id: "letter-4x2",
    name: '8.5x11" sheet — 4 x 2 (8 per page)',
    page: { widthIn: 8.5, heightIn: 11 },
    cols: 4,
    rows: 2,
    qrPx: 130,
    stacked: true,
    perPage: 8,
  },
  "letter-2x5": {
    id: "letter-2x5",
    name: '8.5x11" sheet — 5 x 2 (10 per page)',
    page: { widthIn: 8.5, heightIn: 11 },
    cols: 2,
    rows: 5,
    qrPx: 150,
    // Same stacked treatment as the 4 x 2 sheet: QR above the details.
    stacked: true,
    perPage: 10,
  },
  "label-7676": {
    id: "label-7676",
    name: 'White 7676 — 2.99" x 2.99" label printer',
    page: { widthIn: 2.99, heightIn: 2.99 },
    cols: 1,
    rows: 1,
    qrPx: 170,
    stacked: true,
    perPage: 1,
  },
  "avery-8593": {
    id: "avery-8593",
    name: 'Avery 8593 — 2/3" x 3-7/16" shortened, 30 per sheet',
    page: { widthIn: 8.5, heightIn: 11 },
    cols: 3,
    rows: 10,
    qrPx: 0,
    stacked: false,
    perPage: 30,
    short: true,
  },
};

export const LABEL_FORMAT_LIST: LabelFormatSpec[] = [
  LABEL_FORMATS["letter-4x2"],
  LABEL_FORMATS["letter-2x5"],
  LABEL_FORMATS["label-7676"],
  LABEL_FORMATS["avery-8593"],
];


/** Rendered QR box for the small in-cell code on shortened (Avery 8593) labels. */
export const SHORT_QR_PX = 52;

export function usePanelQrSvg(
  url: string,
  format: LabelFormat,
  pxOverride?: number,
): string | null {
  const [svg, setSvg] = useState<string | null>(null);
  const px = pxOverride ?? LABEL_FORMATS[format].qrPx;
  useEffect(() => {
    let live = true;
    QRCode.toString(url, {
      type: "svg",
      errorCorrectionLevel: "M", // survives a dusty label without bloating the modules
      margin: 1,
      width: px * 3, // oversample: the SVG scales down cleanly at print dpi
    })
      .then((out) => {
        if (live) setSvg(out);
      })
      .catch(() => {
        if (live) setSvg(null);
      });
    return () => {
      live = false;
    };
  }, [url, px]);
  return svg;
}

/**
 * Print CSS for one format: page size plus a fixed label grid so each printed
 * label lands on its physical cell. Render once per print view.
 */
export function labelPrintCss(format: LabelFormat): string {
  const spec = LABEL_FORMATS[format];
  const marginIn = spec.id === "label-7676" ? 0.08 : 0.25;
  const cellW = (spec.page.widthIn - marginIn * 2) / spec.cols;
  const cellH = (spec.page.heightIn - marginIn * 2) / spec.rows;
  return `@media print {
  @page { size: ${spec.page.widthIn}in ${spec.page.heightIn}in; margin: ${marginIn}in; }
  .panel-label-grid {
    display: grid !important;
    grid-template-columns: repeat(${spec.cols}, ${cellW}in) !important;
    grid-auto-rows: ${cellH}in !important;
    gap: 0 !important;
  }
  .panel-label-cell {
    width: ${cellW}in;
    height: ${cellH}in;
    overflow: hidden;
    break-inside: avoid;
    page-break-inside: avoid;
  }
}`;
}

interface PanelQrLabelProps {
  panel: PanelLabelSource & { voltage_designation?: string | null };
  origin: string;
  format?: LabelFormat;
  /** Include a small in-cell QR on shortened (Avery 8593) labels. */
  shortQr?: boolean;
  className?: string;
}

export function PanelQrLabel({
  panel,
  origin,
  format = "letter-2x5",
  shortQr = false,
  className,
}: PanelQrLabelProps) {
  const spec = LABEL_FORMATS[format];
  const url = useMemo(() => panelQrUrl(origin, panel.panel_id), [origin, panel.panel_id]);
  const svg = usePanelQrSvg(url, format, spec.short ? SHORT_QR_PX : undefined);
  const lines = useMemo(
    () => panelLabelLines(panel, panel.voltage_designation ?? null),
    [panel],
  );
  const compact = spec.id !== "letter-2x5";

  // Avery 8593 file-folder stock is 2/3" tall: text only, no QR.
  if (spec.short) {
    return (
      <ShortLabelCell
        stableId={panel.panel_id}
        detail={lines
          .slice(0, 2)
          .map((l) => l.value)
          .join(" · ")}
        qrSvg={shortQr ? svg : null}
        showQr={shortQr}
        className={className}
      />
    );
  }



  return (
    <div
      className={cn(
        "panel-label-cell flex break-inside-avoid gap-3 rounded-lg border border-border bg-card p-3",
        spec.stacked ? "flex-col items-center text-center" : "flex-row items-start",
        className,
      )}
    >
      {svg ? (
        <div
          className="shrink-0 [&_svg]:h-auto [&_svg]:w-full"
          style={{ width: spec.qrPx }}
          // qrcode renders a self-contained SVG with no scripts or external references.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div
          className="aspect-square shrink-0 animate-pulse rounded bg-muted"
          style={{ width: spec.qrPx }}
        />
      )}
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "font-mono font-bold leading-tight text-foreground",
            compact ? "text-lg" : "text-2xl",
          )}
        >
          {panel.panel_id}
        </p>
        <dl className={cn("mt-1 space-y-0.5 text-left", compact ? "text-[9px]" : "text-xs")}>
          {(compact ? lines.slice(0, 4) : lines).map((line) => (
            <div key={line.label} className="flex gap-2">
              <dt className={cn("shrink-0 text-muted-foreground", compact ? "w-16" : "w-24")}>
                {line.label}
              </dt>
              <dd className="min-w-0 flex-1 break-words font-medium text-foreground">{line.value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-1 break-all font-mono text-[8px] leading-tight text-muted-foreground">{url}</p>
        {compact ? null : (
          <p className="text-[10px] text-muted-foreground">
            Scan for the current panel record (read-only). Editing requires administrator approval.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * One shortened, text-only label cell (Avery 8593 file-folder stock). The stable
 * ID stays large and monospaced so it is readable on a conduit or box; the
 * condensed detail line is truncated by the cell, never wrapped off the label.
 */
export function ShortLabelCell({
  stableId,
  detail,
  qrSvg,
  showQr = false,
  className,
}: {
  stableId: string;
  detail: string;
  /** Small QR for the app record; only rendered when showQr is set. */
  qrSvg?: string | null;
  showQr?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "panel-label-cell flex items-center gap-1.5 overflow-hidden break-inside-avoid rounded border border-border bg-card px-2 py-1",
        className,
      )}
    >
      {showQr ? (
        qrSvg ? (
          <div
            className="shrink-0 [&_svg]:h-full [&_svg]:w-full"
            style={{ width: SHORT_QR_PX, height: SHORT_QR_PX }}
            // qrcode renders a self-contained SVG with no scripts or external references.
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
        ) : (
          <div
            className="shrink-0 animate-pulse rounded bg-muted"
            style={{ width: SHORT_QR_PX, height: SHORT_QR_PX }}
          />
        )
      ) : null}
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "font-mono font-bold leading-tight text-foreground",
            // With the QR taking the left half the ID wraps onto a second line
            // instead of being cut off mid-identifier.
            showQr ? "break-all text-[10px] [overflow-wrap:anywhere]" : "truncate text-[11px]",
          )}
        >
          {stableId}
        </p>
        {detail ? (
          <p
            className={cn(
              "text-[8px] leading-tight text-muted-foreground",
              showQr ? "line-clamp-2" : "truncate",
            )}
          >
            {detail}
          </p>
        ) : null}
      </div>
    </div>
  );
}
