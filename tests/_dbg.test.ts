import { it } from "vitest";
import { assignProposedCircuitGroupIds, buildManifestGraph, classifyItem, parseManifest } from "@/lib/electrical-audit-batch";
import { buildFsNwAuditManifestR2 } from "@/lib/electrical-fs-nw-audit-r1";
it("dbg", () => {
  const m = buildFsNwAuditManifestR2();
  console.log("scopeLen", m.scope.length, parseManifest(JSON.stringify(m)).errors);
  const { items } = assignProposedCircuitGroupIds([...m.items], []);
  const graph = buildManifestGraph(items);
  const resolved = new Map([["panel|PNL-FS-NW", "panel-uuid"]]);
  const c = items.map((i) => classifyItem(i, { target: i.entity_kind === "load" && i.target_stable_id ? { id: "x", stable_id: i.target_stable_id } : null, resolved, pendingCreates: graph.pendingCreates }));
  const by: Record<string, number> = {};
  for (const i of c) by[`${i.entity_kind}:${i.operation}`] = (by[`${i.entity_kind}:${i.operation}`] ?? 0) + i.changes.length;
  console.log(by, "total", c.reduce((a,i)=>a+i.changes.length,0));
});
