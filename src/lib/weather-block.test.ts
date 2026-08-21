import { describe, expect, it } from "vitest";
import {
  findWeatherBlock,
  replaceWeatherBlock,
  weatherBlockMissingExtras,
} from "./weather-block";

const FRESH =
  "## Weather · BosteadFarmHouse\nSunny · High 92 / Low 68 · Feels like 96°F / 70°F · 71% humidity\n";

const TASKS = [
  "## Tasks",
  "- [ ] Order steel doors #task/order-steel-doors #project/barn",
  "- [x] Grease loader pins #task/grease-loader-pins",
  "- [ ] Check drip zone 3 #task/check-drip-zone-3",
  "",
  "## Notes",
  "Hot day, pushed mowing to Friday.",
].join("\n");

describe("weather block refresh", () => {
  it("replaces only the weather block and keeps every task line", () => {
    const stale = "## Weather · BosteadFarmHouse\nSunny · High 92 / Low 68\n";
    const note = `${stale}\n${TASKS}`;

    const next = replaceWeatherBlock(note, FRESH);

    expect(next).toBe(`${FRESH}\n${TASKS}`);
    expect(next).toContain("#task/order-steel-doors");
    expect(next).toContain("- [x] Grease loader pins #task/grease-loader-pins");
    expect(next).toContain("#task/check-drip-zone-3");
    expect(next).toContain("Hot day, pushed mowing to Friday.");
    // one heading, no duplicated weather text
    expect(next.match(/^## Weather/gm)?.length).toBe(1);
  });

  it("does not swallow a task line that directly follows the heading", () => {
    const note = [
      "## Weather · BosteadFarmHouse",
      "- [ ] Order steel doors #task/order-steel-doors",
      "- [ ] Grease loader pins #task/grease-loader-pins",
    ].join("\n");

    expect(findWeatherBlock(note)).toBe("## Weather · BosteadFarmHouse\n");

    const next = replaceWeatherBlock(note, FRESH);
    expect(next).toContain("- [ ] Order steel doors #task/order-steel-doors");
    expect(next).toContain("- [ ] Grease loader pins #task/grease-loader-pins");
    expect(next.split("\n").filter((l) => l.startsWith("- [ ]")).length).toBe(2);
  });

  it("prepends the block when the note has none, without touching content", () => {
    const next = replaceWeatherBlock(TASKS, FRESH);
    expect(next).toBe(`${FRESH}\n${TASKS}`);
  });

  it("handles CRLF notes without eating the next line", () => {
    const note = "## Weather · Bostead\r\nSunny · High 90 / Low 66\r\n\r\n- [ ] Fix gate #task/fix-gate\r\n";
    const next = replaceWeatherBlock(note, FRESH);
    expect(next).toContain("- [ ] Fix gate #task/fix-gate");
  });

  it("detects blocks missing humidity or feels-like", () => {
    expect(weatherBlockMissingExtras("")).toBe(true);
    expect(weatherBlockMissingExtras("## Weather\nSunny · High 92 / Low 68\n")).toBe(true);
    expect(
      weatherBlockMissingExtras("## Weather\nSunny · High 92 / Low 68 · Feels like 96°F / 70°F\n"),
    ).toBe(true);
    expect(weatherBlockMissingExtras(FRESH)).toBe(false);
  });

  it("is idempotent across repeated refreshes", () => {
    const note = `${FRESH}\n${TASKS}`;
    expect(replaceWeatherBlock(replaceWeatherBlock(note, FRESH), FRESH)).toBe(note);
  });
});
