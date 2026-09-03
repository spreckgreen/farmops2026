// Printable label for any non-panel electrical record: conduit, junction box,
// branch run, load, circuit group, feeder, equipment rack, power asset or
// powered device. The QR opens that record's detail page, e.g.
// https://bostead.lovable.app/electrical/item/raceway/<uuid>
import { useMemo } from "react";
import {
  LABEL_FORMATS,
  SHORT_QR_PX,
  ShortLabelCell,
  usePanelQrSvg,
  type LabelFormat,
} from "@/components/electrical/panel-qr-label";
import {
  itemQrUrl,
  labelLines,
  shortLabelText,
  type LabelRecord,
} from "@/lib/electrical-labels";
import { ENTITIES } from "@/lib/electrical-entities";
import { cn } from "@/lib/utils";

interface EntityQrLabelProps {
  record: LabelRecord;
  origin: string;
  format?: LabelFormat;
  /** Include a small in-cell QR on shortened (Avery 8593) labels. */
  shortQr?: boolean;
  className?: string;
}

export function EntityQrLabel({
  record,
  origin,
  format = "letter-2x5",
  shortQr = false,
  className,
}: EntityQrLabelProps) {
  const spec = LABEL_FORMATS[format];
  const url = useMemo(() => itemQrUrl(origin, record.kind, record.id), [origin, record]);
  const svg = usePanelQrSvg(
    url,
    spec.short ? "letter-4x2" : format,
    spec.short ? SHORT_QR_PX : undefined,
  );
  const lines = useMemo(() => labelLines(record), [record]);
  const compact = spec.id !== "letter-4x2";

  if (spec.short) {
    const right = shortRightLines(record);
    return (
      <ShortLabelCell
        stableId={record.stable_id}
        detail={shortLabelText(record)}
        qrSvg={shortQr ? svg : null}
        showQr={shortQr}
        rightTop={right.top}
        rightBottom={right.bottom}
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
            compact ? "text-base" : "text-xl",
          )}
        >
          {record.stable_id}
        </p>
        <p className={cn("text-muted-foreground", compact ? "text-[8px]" : "text-[10px]")}>
          {ENTITIES[record.kind].singular}
        </p>
        <dl className={cn("mt-1 space-y-0.5 text-left", compact ? "text-[9px]" : "text-xs")}>
          {(compact ? lines.slice(0, 4) : lines).map((line) => (
            <div key={line.label} className="flex gap-2">
              <dt className={cn("shrink-0 text-muted-foreground", compact ? "w-14" : "w-20")}>
                {line.label}
              </dt>
              <dd className="min-w-0 flex-1 break-words font-medium text-foreground">
                {line.value}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-1 break-all font-mono text-[8px] leading-tight text-muted-foreground">
          {url}
        </p>
      </div>
    </div>
  );
}
