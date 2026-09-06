import { describe, expect, it } from "vitest";
import { classifyItem } from "@/lib/electrical-audit-batch";
import { buildFsAuditR120260906Manifest } from "@/lib/electrical-fs-audit-r1-20260906";
describe("dbg", () => {
  it("logs", () => {
    const m = buildFsAuditR120260906Manifest();
    const it2 = m.items.find((i) => i.item_key.endsWith("fs-035-pole"))!;
    const r = classifyItem(it2, { target: { id: "u", load_id: "FS-035", updated_at: "x", grid: null } } as never);
    console.log(r.disposition, r.operation, JSON.stringify(r.patch), JSON.stringify(r.messages));
    expect(1).toBe(1);
  });
});
