import { describe, expect, it } from "vitest";
import {
  NAMEPLATE_FIELDS,
  inspectNameplateDataUrl,
  nameplateFields,
  parseNameplateDraft,
} from "@/lib/electrical-nameplate";

const jpegDataUrl = (bytes: number) =>
  `data:image/jpeg;base64,${"A".repeat(Math.ceil((bytes * 4) / 3))}`;

describe("nameplate draft parsing", () => {
  it("reads a fenced JSON reply and keeps only known fields", () => {
    const draft = parseNameplateDraft(
      'Here is the plate:\n```json\n{"voltage":"208-230","phase":"1","fla":"12.4","bogus":"x"}\n```',
    );
    expect(draft).toEqual({ voltage: "208-230", phase: "1", fla: "12.4" });
  });

  it("treats unknown / n-a answers as not legible", () => {
    const draft = parseNameplateDraft('{"serial":"N/A","mocp":"unreadable","hp":"1.5 HP"}');
    expect(draft).toEqual({ serial: null, mocp: null, hp: "1.5 HP" });
  });

  it("returns null when the reply carries no JSON object", () => {
    expect(parseNameplateDraft("I cannot read this photo.")).toBeNull();
    expect(parseNameplateDraft("")).toBeNull();
  });

  it("fills every field in display order, blank where unread", () => {
    const fields = nameplateFields({ voltage: "240" });
    expect(fields).toHaveLength(NAMEPLATE_FIELDS.length);
    expect(fields.find((f) => f.id === "voltage")?.value).toBe("240");
    expect(fields.find((f) => f.id === "serial")?.value).toBeNull();
  });
});

describe("nameplate photo validation", () => {
  it("accepts a small JPEG data URL and reports its real type", () => {
    const info = inspectNameplateDataUrl(jpegDataUrl(400 * 1024));
    expect(info.mimeType).toBe("image/jpeg");
    expect(info.bytes).toBeGreaterThan(390 * 1024);
  });

  it("rejects HEIC and other unsupported types", () => {
    expect(() => inspectNameplateDataUrl("data:image/heic;base64,AAAA")).toThrow(/not supported/i);
  });

  it("rejects a photo over the size cap", () => {
    expect(() => inspectNameplateDataUrl(jpegDataUrl(7 * 1024 * 1024))).toThrow(/MB/);
  });

  it("rejects anything that is not a base64 image data URL", () => {
    expect(() => inspectNameplateDataUrl("https://example.com/plate.jpg")).toThrow(/data URL/i);
  });
});
