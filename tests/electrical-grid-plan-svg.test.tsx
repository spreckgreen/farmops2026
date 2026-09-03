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
import { PLAN_VIEW_BOX } from "@/lib/electrical-grid-plan-geometry";

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
  const shape = g.querySelector("circle:not([data-anchor-dot]), rect")!;
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
  it("draws the building in physical feet with no raster image", () => {
    const { container } = render(<GridPlanSvg plotted={corners} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 60 40");
    expect(PLAN_VIEW_BOX).toBe("0 0 60 40");
    expect(svg.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
    expect(container.querySelector("image")).toBeNull();
    expect(container.querySelector('[preserveAspectRatio="none"]')).toBeNull();
  });

  it("puts every gridline on its specified feet coordinate", () => {
    const { container } = render(<GridPlanSvg plotted={corners} />);
    const cols = Array.from(container.querySelectorAll("line[data-grid-col]"));
    expect(cols.map((l) => Number(l.getAttribute("x1")))).toEqual([
      0, 8, 16, 24, 32, 40, 48, 56, 60,
    ]);
    for (const l of cols) expect(l.getAttribute("x1")).toBe(l.getAttribute("x2"));
    const rows = Array.from(container.querySelectorAll("line[data-grid-row]"));
    expect(rows.map((l) => Number(l.getAttribute("y1")))).toEqual([0, 8, 16, 24, 32, 40]);
    // 8 -> 9 (56 -> 60 ft) is exactly half the drawn width of 48 -> 56 ft.
    const x = (i: number) => Number(cols[i]!.getAttribute("x1"));
    expect(x(8) - x(7)).toBe((x(7) - x(6)) / 2);
  });

  it("draws the NE man door at X 52.5-55.5 ft on the north wall", () => {
    const { container } = render(<GridPlanSvg plotted={corners} />);
    const g = container.querySelector('[data-opening="MAN DOOR (NE)"]')!;
    expect(g.getAttribute("data-start-ft")).toBe("52.5");
    expect(g.getAttribute("data-end-ft")).toBe("55.5");
    const line = g.querySelector("line")!;
    expect(Number(line.getAttribute("x1"))).toBe(52.5);
    expect(Number(line.getAttribute("x2"))).toBe(55.5);
    expect(Number(line.getAttribute("y1"))).toBe(0);
  });

  it("pins the corner anchors to their physical feet", () => {
    const { container } = render(<GridPlanSvg plotted={corners} />);
    expect(markerCentre(container, "FS-A1")).toEqual({ x: 0, y: 0 });
    expect(markerCentre(container, "FS-A9")).toEqual({ x: 60, y: 0 });
    expect(markerCentre(container, "FS-F1")).toEqual({ x: 0, y: 40 });
    expect(markerCentre(container, "FS-F9")).toEqual({ x: 60, y: 40 });
    expect(markerCentre(container, "FS-D5")).toEqual({ x: 32, y: 24 });
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

  it("collapses co-located records into one exact-anchor cluster badge", () => {
    const stacked = buildOperationalAssets([
      row("FS-S1", "C4"),
      row("FS-S2", "C4"),
      row("FS-S3", "C4"),
    ]);
    const { container } = render(<GridPlanSvg plotted={stacked} />);
    const markers = Array.from(container.querySelectorAll("[data-stable-id]"));
    expect(markers).toHaveLength(1);
    expect(markers[0]!.getAttribute("data-cluster-size")).toBe("3");
    // The single marker stays exactly on the shared anchor: nothing is nudged.
    expect(markerCentre(container, "FS-S1")).toEqual({ x: 24, y: 16 });

    // Selecting a member spiders the group apart, away from the anchor.
    const expanded = render(<GridPlanSvg plotted={stacked} selectedId="FS-S2" />);
    expect(Array.from(expanded.container.querySelectorAll("[data-stable-id]"))).toHaveLength(3);
    const s3 = markerCentre(expanded.container, "FS-S3");
    expect(s3.x === 24 && s3.y === 16).toBe(false);
  });

  it("draws the proposed 2 x 5 overhead LED layer only when enabled", () => {
    const off = render(<GridPlanSvg plotted={corners} />);
    expect(off.container.querySelectorAll("[data-proposed-led]")).toHaveLength(0);

    const { container } = render(<GridPlanSvg plotted={corners} showProposedLeds />);
    const leds = Array.from(container.querySelectorAll("[data-proposed-led]"));
    expect(leds).toHaveLength(10);
    expect(leds.map((g) => [Number(g.getAttribute("data-x-ft")), Number(g.getAttribute("data-y-ft"))])).toEqual([
      [6, 10],
      [18, 10],
      [30, 10],
      [42, 10],
      [54, 10],
      [6, 30],
      [18, 30],
      [30, 30],
      [42, 30],
      [54, 30],
    ]);
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

describe("helper text follows the selected marker", () => {
  it("keeps the selected marker's helper visible after the mouse leaves", () => {
    const { container } = render(
      React.createElement(GridPlanSvg, { plotted: corners, selectedId: "FS-D5", onSelect: () => {} }),
    );
    const d5 = container.querySelector('g[data-stable-id="FS-D5"]') as SVGGElement;
    fireEvent.mouseEnter(d5);
    expect(container.textContent).toContain("FS-D5");
    fireEvent.mouseLeave(d5);
    // Still pinned to the selection, not cleared with the pointer.
    expect(container.textContent).toContain("FS-D5");
    expect(container.textContent).toContain("Verification:");
  });

  it("hovering another marker overrides the pinned helper, then falls back to it", () => {
    const { container } = render(
      React.createElement(GridPlanSvg, { plotted: corners, selectedId: "FS-D5", onSelect: () => {} }),
    );
    const a1 = container.querySelector('g[data-stable-id="FS-A1"]') as SVGGElement;
    fireEvent.mouseEnter(a1);
    const hintText = () => container.querySelector("g[data-hint-card] text")?.textContent;
    expect(hintText()).toBe("FS-A1");
    fireEvent.mouseLeave(a1);
    expect(container.textContent).toContain("FS-D5");
  });

  it("Escape dismisses the pinned helper", () => {
    const { container } = render(
      React.createElement(GridPlanSvg, { plotted: corners, selectedId: "FS-D5", onSelect: () => {} }),
    );
    const d5 = container.querySelector('g[data-stable-id="FS-D5"]') as SVGGElement;
    fireEvent.keyDown(d5, { key: "Escape" });
    expect(container.textContent).not.toContain("Verification:");
  });
});
