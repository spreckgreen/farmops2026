// Camera coverage on the Farm Shop plan.
//
// Uses the SAME single documented transform as every other electrical map
// (`feetToPlan` from the frozen plan geometry), so a camera marker and an
// electrical marker at the same feet land on the same spot.
//
// Only recorded facts are drawn: a camera without X/Y is not plotted at all, and
// a camera without a facing direction is plotted as a point with no wedge.
import { useMemo } from "react";
import planImage from "@/assets/farm-shop-grid-plan.png";
import { PLAN_DRAWING, PLAN_VIEW_BOX, feetToPlan } from "@/lib/electrical-grid-plan-geometry";
import {
  CAMERA_STATUS_LABEL,
  cameraStatus,
  coverageWedgeFeet,
  hasCoverageDirection,
  headingLabel,
  isPlaced,
  type CameraRow,
} from "@/lib/cameras";

/** Marker/wedge colours per status, matched to the on-screen legend. */
const STATUS_HEX: Record<string, string> = {
  online: "#059669",
  offline: "#dc2626",
  unknown: "#64748b",
};

export function CameraCoverageMap({
  cameras,
  selectedId,
  onSelect,
}: {
  cameras: readonly CameraRow[];
  selectedId?: string | null;
  onSelect?: (camera: CameraRow) => void;
}) {
  const plotted = useMemo(() => cameras.filter((c) => isPlaced(c)), [cameras]);

  return (
    <svg
      viewBox={PLAN_VIEW_BOX}
      className="block h-auto w-full rounded-md border border-border bg-card"
      role="img"
      aria-label="Farm Shop plan with camera positions and coverage areas"
      preserveAspectRatio="xMidYMid meet"
    >
      <image
        href={planImage}
        x={0}
        y={0}
        width={PLAN_DRAWING.width}
        height={PLAN_DRAWING.height}
        opacity={0.85}
      />
      {plotted.map((camera) => {
        const status = cameraStatus(camera);
        const hex = STATUS_HEX[status] ?? STATUS_HEX['unknown']!;
        const wedge = coverageWedgeFeet(camera);
        const centre = feetToPlan(Number(camera.x_feet), Number(camera.y_feet));
        const selected = selectedId === camera.id;
        const heading = headingLabel(camera.heading_degrees);
        const label = `${camera.camera_id} ${camera.name}. ${CAMERA_STATUS_LABEL[status]}. ${
          hasCoverageDirection(camera)
            ? `Facing ${heading}, ${camera.fov_degrees}° view, ${camera.range_feet} ft.`
            : "No facing direction recorded."
        }`;
        return (
          <g
            key={camera.id}
            role="button"
            tabIndex={0}
            aria-label={label}
            onClick={() => onSelect?.(camera)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect?.(camera);
              }
            }}
            className="cursor-pointer focus:outline-none"
          >
            <title>{label}</title>
            {wedge ? (
              <polygon
                points={wedge
                  .map((p) => {
                    const q = feetToPlan(p.xFt, p.yFt);
                    return `${q.x.toFixed(1)},${q.y.toFixed(1)}`;
                  })
                  .join(" ")}
                fill={hex}
                fillOpacity={selected ? 0.34 : 0.16}
                stroke={hex}
                strokeOpacity={selected ? 0.9 : 0.5}
                strokeWidth={selected ? 3 : 2}
              />
            ) : null}
            <circle
              cx={centre.x}
              cy={centre.y}
              r={selected ? 13 : 10}
              fill={hex}
              stroke="#ffffff"
              strokeWidth={3}
            />
            <text
              x={centre.x + 16}
              y={centre.y - 12}
              fontSize={22}
              fontWeight={600}
              fill="#0f172a"
              stroke="#ffffff"
              strokeWidth={5}
              paintOrder="stroke"
            >
              {camera.camera_id}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
