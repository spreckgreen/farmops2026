import { describe, expect, it } from "vitest";
import { POLE_SEQUENCE } from "@/lib/electrical-audit-batch";
import {
  PROPOSED_POST_POSITIONS,
  postObservationFeet,
  proposedPostFeet,
} from "@/lib/electrical-grid-post-geometry";
import { placementCandidatesFor } from "@/lib/electrical-grid-operational";

const base = {
  kind: "load" as const,
  stableId: "FS-999",
  description: null,
  grid: null,
  designGrid: null,
  legacyGrid: null,
  gridReference: null,
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
  location: null,
  panel: null,
  panelBasis: null,
  circuitClass: null,
  circuitClassBasis: null,
};

describe("proposed perimeter post geometry", () => {
  it("covers every post in the frozen sequence once", () => {
    expect(PROPOSED_POST_POSITIONS).toHaveLength(POLE_SEQUENCE.length);
    expect(new Set(PROPOSED_POST_POSITIONS.map((p) => p.ref)).size).toBe(POLE_SEQUENCE.length);
  });

  it("fixes the four recorded corners", () => {
    expect(proposedPostFeet("01NE")).toMatchObject({ xFt: 60, yFt: 0 });
    expect(proposedPostFeet("Post 06SE")).toMatchObject({ xFt: 60, yFt: 40 });
    expect(proposedPostFeet("14SW")).toMatchObject({ xFt: 0, yFt: 40 });
    expect(proposedPostFeet("19NW")).toMatchObject({ xFt: 0, yFt: 0 });
  });

  it("keeps every post on the outline", () => {
    for (const p of PROPOSED_POST_POSITIONS) {
      const onEdge = p.xFt === 0 || p.xFt === 60 || p.yFt === 0 || p.yFt === 40;
      expect(onEdge).toBe(true);
    }
  });

  it("returns nothing for unknown or incomplete observations", () => {
    expect(proposedPostFeet("99XX")).toBeNull();
    expect(
      postObservationFeet({ pole_location_kind: "BETWEEN_POSTS", pole_ref_start: "01NE" }),
    ).toBeNull();
    expect(postObservationFeet({ pole_location_kind: "NOT_APPLICABLE" })).toBeNull();
  });

  it("marks a between-posts observation as a span", () => {
    expect(
      postObservationFeet({
        pole_location_kind: "BETWEEN_POSTS",
        pole_ref_start: "01NE",
        pole_ref_end: "02NE",
      }),
    ).toMatchObject({ xFt: 60, yFt: 4, spanned: true });
  });
});

describe("observed placement sources", () => {
  it("ranks an applied field-observed grid above inherited grid assignments", () => {
    const c = placementCandidatesFor({ ...base, grid: "B3", fieldGridReference: "F9" });
    expect(c[0]?.source).toBe("OBSERVED_FIELD_GRID");
  });

  it("plots a staged observation as a pending, non-accepted layer", () => {
    const c = placementCandidatesFor({
      ...base,
      grid: "B3",
      pendingObservation: {
        batchId: "FA-FS-2026-09-03-PM-R1",
        itemKey: "item-1",
        fieldGridReference: "F9",
        poleScheme: null,
        poleLocationKind: null,
        poleRefStart: null,
        poleRefEnd: null,
        observedAt: "2026-09-03",
        evidence: null,
      },
    });
    const pending = c.find((x) => x.source === "PENDING_FIELD_OBSERVATION");
    expect(pending?.accepted).toBe(false);
    expect(c.indexOf(pending!)).toBeLessThan(
      c.findIndex((x) => x.source === "DERIVED_FROM_LEGACY_GRID"),
    );
  });

  it("plots a confirmed post callout at nearest-post precision", () => {
    const c = placementCandidatesFor({
      ...base,
      poleScheme: "FS_POLE_GRID_V1",
      poleLocationKind: "AT_POST",
      poleRefStart: "Post 06SE",
    });
    const post = c.find((x) => x.source === "OBSERVED_POST");
    expect(post).toMatchObject({ xFt: 60, yFt: 40, precision: "NEAREST", spanned: false });
  });
});

