import { it } from "vitest";
import { mapSheet } from "@/lib/electrical-ods";
import { importColumns } from "@/lib/electrical-entities";
it("dbg", () => {
const dup={name:"Load_Master",rows:[["Load ID","Source / Reference","Source / Reference"],["FS-042","Sheet 3","Field survey"]]};
console.log(JSON.stringify(mapSheet(dup,"load",importColumns("load"),"load_id")));
const un={name:"Load_Master",rows:[["Load ID",""],["FS-042","12.5 kVA"]]};
console.log(JSON.stringify(mapSheet(un,"load",importColumns("load"),"load_id")));
});
