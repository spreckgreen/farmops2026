// Compass coverage for cameras that have no measured position yet.
//
// A building without a location grid has no honest X/Y in feet, so nothing is
// drawn on a plan. What IS known is which side each camera sits on and, from
// Ring's own published figures, how wide it sees. That is drawn as a wedge on a
// compass rose around a plain building box — a direction picture, not a map.
import { useMemo } from "react";
import {
  COMPASS_SIDES,
  COMPASS_SIDE_LABEL,
  aimByCompassSide,
  isCompassSide,
  ringModelLabel,
  type GridAwareCamera,
} from "@/lib/ring-cameras";

const R_INNER = 26;
const R_OUTER = 92;

function wedgePath(headingDeg: number, fovDeg: number): string {
  const half = Math.min(180, Math.max(1, fovDeg / 2));
  const pt = (deg: number, r: number) => {
    const rad = (deg * Math.PI) / 180;
    return [120 + Math.sin(rad) * r, 120 - Math.cos(rad) * r] as const;
  };
  const [x1, y1] = pt(headingDeg - half, R_INNER);
  const [x2, y2] = pt(headingDeg - half, R_OUTER);
  const [x3, y3] = pt(headingDeg + half, R_OUTER);
  const [x4, y4] = pt(headingDeg + half, R_INNER);
  const large = half * 2 > 180 ? 1 : 0;
  return `M ${x1} ${y1} L ${x2} ${y2} A ${R_OUTER} ${R_OUTER} 0 ${large} 1 ${x3} ${y3} L ${x4} ${y4} A ${R_INNER} ${R_INNER} 0 ${large} 0 ${x1} ${y1} Z`;
}

export function CompassCoverage({
  cameras,
  selectedId,
  onSelect,
}: {
  cameras: readonly (GridAwareCamera & { name: string; id: string })[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const aims = useMemo(() => aimByCompassSide(cameras), [cameras]);
  const sided = cameras.filter((c) => isCompassSide(c.compass_side));
  const unsided = cameras.filter((c) => !isCompassSide(c.compass_side));

  return (
    <div className="grid gap-4 md:grid-cols-[240px_1fr]">
      <svg viewBox="0 0 240 240" className="w-full max-w-[240px]" role="img" aria-label="Compass coverage">
        <circle cx={120} cy={120} r={R_OUTER} fill="var(--muted)" opacity={0.35} />
        {sided.map((camera) => {
          const aim = aims.get(camera.camera_id);
          if (!aim) return null;
          const active = selectedId === camera.id;
          return (
            <path
              key={camera.id}
              d={wedgePath(aim.headingDegrees, aim.fovDegrees)}
              fill="var(--chart-2)"
              opacity={active ? 0.55 : 0.22}
              stroke="var(--chart-2)"
              strokeWidth={active ? 1.5 : 0.6}
              className="cursor-pointer"
              onClick={() => onSelect?.(camera.id)}
            />
          );
        })}
        <rect x={92} y={92} width={56} height={56} rx={2} fill="var(--background)" stroke="var(--foreground)" strokeWidth={1.5} />
        <text x={120} y={124} textAnchor="middle" fontSize={9} fill="var(--foreground)">
          building
        </text>
        {(
          [
            ["N", 120, 16],
            ["E", 226, 124],
            ["S", 120, 232],
            ["W", 14, 124],
          ] as const
        ).map(([label, x, y]) => (
          <text key={label} x={x} y={y} textAnchor="middle" fontSize={11} fill="var(--muted-foreground)">
            {label}
          </text>
        ))}
      </svg>

      <div className="space-y-3 text-sm">
        {COMPASS_SIDES.filter((side) => sided.some((c) => c.compass_side === side)).map((side) => {
          const members = sided
            .filter((c) => c.compass_side === side)
            .sort((a, b) => Number(a.side_slot ?? 99) - Number(b.side_slot ?? 99));
          return (
            <div key={side} className="rounded-md border border-border p-3">
              <p className="font-medium">{COMPASS_SIDE_LABEL[side]}</p>
              <ul className="mt-1 space-y-1">
                {members.map((camera) => {
                  const aim = aims.get(camera.camera_id);
                  return (
                    <li key={camera.id}>
                      <button
                        type="button"
                        className="text-left hover:underline"
                        onClick={() => onSelect?.(camera.id)}
                      >
                        <span className="font-mono text-xs">{camera.camera_id}</span> {camera.name}
                      </button>
                      <p className="text-xs text-muted-foreground">
                        {ringModelLabel(camera.ring_model) ?? "Ring model not recorded"}
                        {aim ? ` · aimed ${Math.round(aim.headingDegrees)}° · ${aim.fovDegrees}° wide` : " · no view width known yet"}
                      </p>
                      {aim ? <p className="text-xs text-muted-foreground">{aim.basis}</p> : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        {unsided.length ? (
          <div className="rounded-md border border-dashed border-border p-3">
            <p className="font-medium">No side recorded yet</p>
            <p className="text-xs text-muted-foreground">
              Choose a side for {unsided.map((c) => c.camera_id).join(", ")} to show them here.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
