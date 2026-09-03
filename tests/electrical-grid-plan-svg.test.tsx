// Rendering regression: the plan and every marker live in ONE SVG viewBox, so
// marker coordinates are identical no matter how large the container is rendered.
import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import React from "react";
import { GridPlanSvg } from "@/components/electrical/grid-plan-svg";
import {
  buildOperationalAssets,
  type OperationalInput,
} from "@/lib/electrical-grid-operational";
import { PLAN_ANCHORS_PX, PLAN_VIEW_BOX, feetToPlanPx } from "@/lib/electrical-grid-plan-geometry";

const row = (stableId: string, gridReference: string): OperationalInput => ({
  kind: "load",
  stableId,
  description: stableId,
  grid: null,
  designGrid: null,
  legacyGrid: null,
  gridReference,
  storedPrecision: null,
  xFt: null,
  yFt: null,
  designXFt: null,
  designYFt: null,
  installStatus: null,
  verification: null,
  verificationNotes: null,
  locationEvidence: null,
  verifiedAt: null,
  updatedAt: null,
  location: "Farm Shop",
  panel: null,
  panelBasis: null,
  circuitClass: null,
  circuitClassBasis: null,
});

const corners = buildOperationalAssets([
  row("FS-A1", "A1"),
  row("FS-A9", "A9"),
  row("FS-F1", "F1"),
  row("FS-F9", "F9"),
  row("FS-D5", "D5"),
]);

function markerCentre(container: HTMLElement, stableId: string) {
  const g = container.querySelector(`[data-stable-id="${stableId}"]`)!;
  const shape = g.querySelector("circle, rect")!;
  if (shape.tagName === "circle") {
    return { x: Number(shape.getAttribute("cx")), y: Number(shape.getAttribute("cy")) };
  }
  const x = Number(shape.getAttribute("x"));
  const y = Number(shape.getAttribute("y"));
  const w = Number(shape.getAttribute("width"));
  const h = Number(shape.getAttribute("height"));
  return { x: x + w / 2, y: y + h / 2 };
}

describe("grid plan svg", () => {
  it("uses one fixed viewBox for the plan and the markers", () => {
    const { container } = render(<GridPlanSvg plotted={corners} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe(PLAN_VIEW_BOX);
    // The plan image is inside the same SVG, drawn at the viewBox origin.
    const image = container.querySelector("image")!;
    expect(image.getAttribute("x")).toBe("0");
    expect(image.getAttribute("y")).toBe("0");
  });

  it("pins the corner anchors to the wall centrelines", () => {
    const { container } = render(<GridPlanSvg plotted={corners} />);
    expect(markerCentre(container, "FS-A1")).toEqual({
      x: PLAN_ANCHORS_PX.westWallX,
      y: PLAN_ANCHORS_PX.northWallY,
    });
    expect(markerCentre(container, "FS-A9")).toEqual({
      x: PLAN_ANCHORS_PX.eastWallX,
      y: PLAN_ANCHORS_PX.northWallY,
    });
    expect(markerCentre(container, "FS-F1")).toEqual({
      x: PLAN_ANCHORS_PX.westWallX,
      y: PLAN_ANCHORS_PX.southWallY,
    });
    expect(markerCentre(container, "FS-F9")).toEqual({
      x: PLAN_ANCHORS_PX.eastWallX,
      y: PLAN_ANCHORS_PX.southWallY,
    });
    const d5 = feetToPlanPx(32, 24);
    expect(markerCentre(container, "FS-D5").x).toBeCloseTo(d5.x, 6);
    expect(markerCentre(container, "FS-D5").y).toBeCloseTo(d5.y, 6);
  });

  it("keeps marker coordinates unchanged across container widths and marker scales", () => {
    const widths = ["320px", "768px", "1280px", "2400px"];
    const seen = new Set<string>();
    for (const width of widths) {
      const { container } = render(
        <div style={{ width }}>
          <GridPlanSvg plotted={corners} markerScale={0.8} />
        </div>,
      );
      seen.add(JSON.stringify(markerCentre(container, "FS-D5")));
    }
    expect(seen.size).toBe(1);
  });
});

describe("keyboard and ARIA support", () => {
  it("exposes focusable markers with the full helper text as their label", () => {
    const { container } = render(
      React.createElement(GridPlanSvg, { plotted: corners, onSelect: () => {} }),
    );
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("role")).toBe("group");
    const markers = Array.from(container.querySelectorAll('g[role="button"]'));
    expect(markers).toHaveLength(5);
    for (const m of markers) {
      expect(m.getAttribute("tabindex")).toBe("0");
      const label = m.getAttribute("aria-label") ?? "";
      expect(label).toContain("ft E");
      expect(label).toContain("Verification:");
    }
    // Keyboard help is described on the plan itself.
    expect(container.querySelector("#grid-plan-keyboard-help")?.textContent).toMatch(/arrow keys/i);
  });

  it("static (print) render stays a single image with no focusable markers", () => {
    const { container } = render(
      React.createElement(GridPlanSvg, { plotted: corners, interactive: false }),
    );
    expect(container.querySelector("svg")!.getAttribute("role")).toBe("img");
    expect(container.querySelectorAll('g[role="button"]')).toHaveLength(0);
  });

  it("Enter selects the focused marker and Escape dismisses the helper text", () => {
    const picked: string[] = [];
    const { container } = render(
      React.createElement(GridPlanSvg, { plotted: corners, onSelect: (id: string) => picked.push(id) }),
    );
    const first = container.querySelector('g[data-stable-id="FS-A1"]') as SVGGElement;
    fireEvent.focus(first);
    expect(container.textContent).toContain("Verification:");
    fireEvent.keyDown(first, { key: "Enter" });
    expect(picked).toEqual(["FS-A1"]);
    fireEvent.keyDown(first, { key: "Escape" });
    expect(container.textContent).not.toContain("Verification:");
  });

  it("arrow keys move focus north-to-south then west-to-east", () => {
    const { container } = render(
      React.createElement(GridPlanSvg, { plotted: corners, onSelect: () => {} }),
    );
    const a1 = container.querySelector('g[data-stable-id="FS-A1"]') as SVGGElement;
    a1.focus();
    fireEvent.keyDown(a1, { key: "ArrowRight" });
    expect((document.activeElement as Element).getAttribute("data-stable-id")).toBe("FS-A9");
    const a9 = document.activeElement as SVGGElement;
    fireEvent.keyDown(a9, { key: "ArrowLeft" });
    expect((document.activeElement as Element).getAttribute("data-stable-id")).toBe("FS-A1");
    fireEvent.keyDown(document.activeElement as SVGGElement, { key: "End" });
    expect((document.activeElement as Element).getAttribute("data-stable-id")).toBe("FS-F9");
  });
});
