import { describe, it, expect } from "vitest";
import { slugify, todayDateString } from "@/lib/slug";

describe("slugify", () => {
  it("lowercases, hyphenates spaces, strips punctuation", () => {
    expect(slugify("Hello World!")).toBe("hello-world");
  });
  it("collapses repeated separators and trims", () => {
    expect(slugify("  Foo   Bar -- Baz  ")).toBe("foo-bar-baz");
  });
  it("removes non a-z0-9 chars", () => {
    expect(slugify("Cafe Über #42")).toBe("cafe-ber-42");
  });
  it("caps at 60 chars", () => {
    expect(slugify("a".repeat(120)).length).toBe(60);
  });
  it("returns empty string for empty input", () => {
    expect(slugify("   ")).toBe("");
  });
});

describe("todayDateString", () => {
  it("returns YYYY-MM-DD format", () => {
    expect(todayDateString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("matches local date components", () => {
    const d = new Date();
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect(todayDateString()).toBe(expected);
  });
});
