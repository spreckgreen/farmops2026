import { describe, expect, it } from "vitest";
import {
  serviceManualPrompt,
  usageLabel,
  manualTemplateFileName,
  SERVICE_MANUAL_TEMPLATE,
} from "@/lib/service-manual-template";
import { extractJsonObject } from "@/lib/ai-json";

describe("service manual template", () => {
  it("labels usage from hours and miles", () => {
    expect(usageLabel({ assetName: "x", currentMiles: 103 })).toBe("103 miles");
    expect(usageLabel({ assetName: "x", currentHours: 50, currentMiles: 103 })).toBe(
      "50 hours / 103 miles",
    );
    expect(usageLabel({ assetName: "x" })).toBe("new (no recorded usage)");
  });

  it("builds a prompt that pins the importable sections", () => {
    const p = serviceManualPrompt({
      assetName: "Kubota L2501",
      category: "Tractor",
      currentMiles: 103,
      usageContext: "brush hogging",
    });
    expect(p).toContain("Kubota L2501");
    expect(p).toContain("103 miles");
    expect(p).toContain("## Service Intervals");
    expect(p).toContain("Parts: <part name> x <quantity> <unit>");
    expect(p).toContain("brush hogging");
  });

  it("ships a blank template with the bullet shape", () => {
    expect(SERVICE_MANUAL_TEMPLATE).toContain("- Service: Engine oil and filter change");
    expect(SERVICE_MANUAL_TEMPLATE).toContain("Interval: every 100 hours");
  });

  it("slugs the download filename", () => {
    expect(manualTemplateFileName("Kubota L2501!")).toBe(
      "service-manual-template-kubota-l2501.md",
    );
  });
});

describe("extractJsonObject", () => {
  it("reads fenced JSON with prose around it", () => {
    const text = 'Sure!\n```json\n{"intervals":[{"name":"Oil"}]}\n```\nHope that helps.';
    expect(extractJsonObject(text)).toEqual({ intervals: [{ name: "Oil" }] });
  });

  it("returns null when there is no object", () => {
    expect(extractJsonObject("no json here")).toBeNull();
  });
});
