import { describe, expect, it } from "vitest";
import { appendProcedureBody, describeSaveMode } from "@/lib/procedure-append";

const day = new Date("2026-08-24T12:00:00Z");

describe("appendProcedureBody", () => {
  it("adds a dated section under the existing body", () => {
    const out = appendProcedureBody("! Mower\n\nOld steps\n", "New steps", "Workshop manual", day);
    expect(out).toBe("! Mower\n\nOld steps\n\n----\n!! Added 2026-08-24 — Workshop manual\n\nNew steps\n");
  });

  it("skips content that is already on the page", () => {
    const existing = "! Mower\n\nNew steps\n";
    expect(appendProcedureBody(existing, "New steps", "SOP", day)).toBe(existing);
  });

  it("handles an empty existing page", () => {
    expect(appendProcedureBody("", "Only steps", undefined, day)).toBe("Only steps\n");
  });

  it("returns the existing body when there is nothing to add", () => {
    expect(appendProcedureBody("! Mower\n", "   ", "SOP", day)).toBe("! Mower\n");
  });

  it("describes modes for toasts", () => {
    expect(describeSaveMode("append")).toBe("appended to");
    expect(describeSaveMode("replace")).toBe("replaced");
    expect(describeSaveMode("create")).toBe("created");
  });
});
