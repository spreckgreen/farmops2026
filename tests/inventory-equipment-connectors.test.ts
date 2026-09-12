import { describe, expect, it } from "vitest";
import { parseEquipmentSearchResults } from "@/lib/inventory-equipment-connectors.functions";

describe("equipment documentation search parsing", () => {
  it("keeps public documentation results and decodes redirect URLs", () => {
    const html = `
      <div class="result results_links">
        <div class="links_main">
          <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.kenwood.com%2Fmanual%2Fts480.pdf">
            Kenwood TS-480SAT instruction manual
          </a>
          <a class="result__snippet">Rear panel includes ANT 1 and ANT 2 SO-239 antenna connectors.</a>
        </div>
      </div>
    `;
    expect(parseEquipmentSearchResults(html)).toEqual([
      expect.objectContaining({
        title: "Kenwood TS-480SAT instruction manual",
        url: "https://www.kenwood.com/manual/ts480.pdf",
        snippet: expect.stringContaining("SO-239"),
      }),
    ]);
  });

  it("rejects private and localhost result targets", () => {
    const html = `
      <div class="result"><div>
        <a class="result__a" href="http://127.0.0.1/admin">internal</a>
        <a class="result__snippet">not public</a>
      </div></div>
      <div class="result"><div>
        <a class="result__a" href="http://localhost/config">local</a>
        <a class="result__snippet">not public</a>
      </div></div>
    `;
    expect(parseEquipmentSearchResults(html)).toEqual([]);
  });
});
