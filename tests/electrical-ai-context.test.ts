import { describe, expect, it } from "vitest";
import {
  buildElectricalRecordContext,
  questionTerms,
} from "@/lib/electrical-ai-context";
import { buildCloudOffer } from "@/lib/ai-escalation-offer";

const panels = [
  { id: "p1", panel_id: "PNL-H1", description: "House main", building: "House", bus_rating_amps: 200 },
  { id: "p2", panel_id: "PNL-S2", description: "Shop sub", building: "Shop", bus_rating_amps: 100 },
];
const groups = [
  { id: "g1", circuit_group_id: "CON-014", description: "Mini split east", panel_uuid: "p1", voltage: 240 },
  { id: "g2", circuit_group_id: "CON-021", description: "Well pump", panel_uuid: "p2", voltage: 240 },
];
const loads = [
  {
    id: "l1",
    load_id: "FS-082",
    description: "Mini split condenser (east)",
    equipment_model: "Bryant 538K",
    circuit_group_uuid: "g1",
    volts: 240,
    amps: 14,
  },
  { id: "l2", load_id: "FS-083", description: "Mini Splits — greenhouse", circuit_group_uuid: null },
  { id: "l3", load_id: "FS-090", description: "Well pump motor", circuit_group_uuid: "g2" },
];
const positions = [
  { panel_uuid: "p1", load_uuid: "l2", position: 12, side: "left", poles: 2, ocp_amps: 20, label: "Mini split GH" },
];

describe("questionTerms", () => {
  it("keeps content words and drops filler", () => {
    expect(questionTerms("What panel is the mini splits on")).toEqual(["mini", "split"]);
  });
});

describe("buildElectricalRecordContext", () => {
  const built = buildElectricalRecordContext({
    panels,
    feeders: [],
    circuitGroups: groups,
    loads,
    positions,
    question: "What panel is the mini splits on",
  });

  it("resolves each load's panel from its circuit group", () => {
    expect(built.block).toContain("load_id=FS-082");
    expect(built.block).toMatch(/FS-082[^\n]*panel=PNL-H1/);
    expect(built.block).toMatch(/FS-082[^\n]*circuit=CON-014/);
  });

  it("falls back to a breaker position when the load has no circuit group", () => {
    expect(built.block).toMatch(/FS-083[^\n]*panel=PNL-H1/);
  });

  it("flags the matching loads for the question", () => {
    expect(built.matchedLoadIds).toContain("FS-082");
    expect(built.matchedLoadIds).toContain("FS-083");
    expect(built.matchedLoadIds).not.toContain("FS-090");
  });

  it("reports counts and a prompt size", () => {
    expect(built.counts.loads).toBe(3);
    expect(built.counts.keyword_matched_loads).toBe(2);
    expect(built.approxTokens).toBeGreaterThan(0);
  });
});

describe("buildCloudOffer", () => {
  it("recommends cloud for a big record on a small local model", () => {
    const o = buildCloudOffer({
      area: "electrical.panel_qa",
      backend: "local",
      localModel: "gemma:latest",
      hostedModel: "google/gemini-3.6-flash",
      hostedAvailable: true,
      contextTokens: 9_000,
    });
    expect(o.recommended).toBe(true);
    expect(o.cost?.usd).toBeGreaterThan(0);
    expect(o.costLabel).toContain("$");
  });

  it("does not recommend cloud when no cloud engine exists", () => {
    const o = buildCloudOffer({
      area: "electrical.panel_qa",
      backend: "local",
      localModel: "gemma:latest",
      hostedModel: null,
      hostedAvailable: false,
      contextTokens: 40_000,
    });
    expect(o.recommended).toBe(false);
  });

  it("stays quiet for a small question on a capable local model", () => {
    const o = buildCloudOffer({
      area: "electrical.field_note",
      backend: "local",
      localModel: "qwen2.5:14b",
      hostedModel: "google/gemini-3.6-flash",
      hostedAvailable: true,
      contextTokens: 800,
    });
    expect(o.recommended).toBe(false);
  });

  it("recommends cloud when the prompt overruns the local context window", () => {
    const o = buildCloudOffer({
      area: "electrical.panel_qa",
      backend: "local",
      localModel: "qwen2.5:14b",
      hostedModel: "google/gemini-3.6-flash",
      hostedAvailable: true,
      contextTokens: 7_000,
      localContextLength: 8_192,
    });
    expect(o.recommended).toBe(true);
    expect(o.reason).toContain("8,192");
  });
});

describe("load-first answer set", () => {
  const built = buildElectricalRecordContext({
    panels,
    feeders: [],
    circuitGroups: groups,
    loads,
    positions,
    question:
      "Which panels and their associated path (if full path is unknown explain what you know today) are the mini-splits planned too",
  });

  it("matches only the mini-split loads, not every planned row", () => {
    expect(built.matchedLoadIds.sort()).toEqual(["FS-082", "FS-083"]);
    expect(built.matchedLoadIds).not.toContain("FS-090");
  });

  it("leads with the load answer set and marks unknown hops", () => {
    const answerIdx = built.block.indexOf("LOAD ANSWER SET");
    expect(answerIdx).toBeGreaterThanOrEqual(0);
    expect(answerIdx).toBeLessThan(built.block.indexOf("PANELS ("));
    expect(built.block).toContain("NOT IN RECORD");
    expect(built.groundedLoadAnswer).toContain("**FS-082 — Mini split condenser (east)**");
    expect(built.groundedLoadAnswer).toContain("**FS-083 — Mini Splits — greenhouse**");
    expect(built.groundedLoadAnswer).toContain("path: circuit=");
  });

  it("does not expand equipment synonyms into unrelated groups", () => {
    expect(built.block).not.toContain("welder");
  });
});
