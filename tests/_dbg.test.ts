import { it } from "vitest";
import { parseManifest } from "@/lib/electrical-audit-batch";
import { buildFsNwAuditManifestR2 } from "@/lib/electrical-fs-nw-audit-r1";
it("dbg", () => {
  const m = buildFsNwAuditManifestR2();
  console.log("scopeLen", m.scope.length);
  console.log(parseManifest(JSON.stringify(m)).errors);
});
