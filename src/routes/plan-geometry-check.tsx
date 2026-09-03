// Temporary verification route: the coordinate-native plan with only the grid,
// wall openings and the proposed overhead-light layer enabled (no records).
import { createFileRoute } from "@tanstack/react-router";
import { GridPlanSvg } from "@/components/electrical/grid-plan-svg";
import { PROPOSED_OVERHEAD_LED_LEGEND } from "@/lib/electrical-grid-plan-geometry";

export const Route = createFileRoute("/plan-geometry-check")({
  component: () => (
    <div style={{ width: 1200, padding: 16, background: "#fff" }}>
      <GridPlanSvg plotted={[]} interactive={false} showProposedLeds />
      <p style={{ fontSize: 13, color: "#334155" }}>{PROPOSED_OVERHEAD_LED_LEGEND}</p>
    </div>
  ),
  head: () => ({ meta: [{ title: "Farm Shop plan geometry check" }] }),
});
