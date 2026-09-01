// Printable panel label: one large QR code plus the details an electrician
// reads at the panel door. The QR encodes the read-only panel sheet URL, e.g.
// https://bostead.lovable.app/electrical/panel/PNL-H1
import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { panelLabelLines, panelQrUrl, type PanelLabelSource } from "@/lib/electrical-panel-access";
import { cn } from "@/lib/utils";

export type QrSize = "sheet" | "large" | "jumbo";

const PIXELS: Record<QrSize, number> = { sheet: 220, large: 380, jumbo: 560 };

export function usePanelQrSvg(url: string, size: QrSize): string | null {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    QRCode.toString(url, {
      type: "svg",
      errorCorrectionLevel: "M", // survives a dusty label without bloating the modules
      margin: 1,
      width: PIXELS[size],
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
  }, [url, size]);
  return svg;
}

interface PanelQrLabelProps {
  panel: PanelLabelSource & { voltage_designation?: string | null };
  origin: string;
  size?: QrSize;
  className?: string;
}

export function PanelQrLabel({ panel, origin, size = "sheet", className }: PanelQrLabelProps) {
  const url = useMemo(() => panelQrUrl(origin, panel.panel_id), [origin, panel.panel_id]);
  const svg = usePanelQrSvg(url, size);
  const lines = useMemo(
    () => panelLabelLines(panel, panel.voltage_designation ?? null),
    [panel],
  );

  return (
    <div
      className={cn(
        "flex break-inside-avoid gap-4 rounded-lg border border-border bg-card p-4",
        size === "sheet" ? "flex-row items-start" : "flex-col items-center text-center",
        className,
      )}
    >
      {svg ? (
        <div
          className="shrink-0 [&_svg]:h-auto [&_svg]:w-full"
          style={{ width: PIXELS[size] / (size === "sheet" ? 1.6 : 1) }}
          // qrcode renders a self-contained SVG with no scripts or external references.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div
          className="aspect-square shrink-0 animate-pulse rounded bg-muted"
          style={{ width: PIXELS[size] / (size === "sheet" ? 1.6 : 1) }}
        />
      )}
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "font-mono font-bold leading-tight text-foreground",
            size === "jumbo" ? "text-4xl" : size === "large" ? "text-3xl" : "text-2xl",
          )}
        >
          {panel.panel_id}
        </p>
        <dl className="mt-2 space-y-0.5 text-left text-xs">
          {lines.map((line) => (
            <div key={line.label} className="flex gap-2">
              <dt className="w-24 shrink-0 text-muted-foreground">{line.label}</dt>
              <dd className="min-w-0 flex-1 break-words font-medium text-foreground">{line.value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 break-all font-mono text-[10px] text-muted-foreground">{url}</p>
        <p className="text-[10px] text-muted-foreground">
          Scan for the current panel record (read-only). Editing requires administrator approval.
        </p>
      </div>
    </div>
  );
}
