// Phase 4.3 — ODS -> FarmOps field mapping matrix.
//
// Read-only coverage report: every meaningful field of the canonical workbook,
// where it lives in FarmOps, who owns it, and how it is transformed. The
// canonical ODS remains the engineering system of record.
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download } from "lucide-react";
import {
  CANONICAL_ODS_PATH,
} from "@/lib/electrical-sor";
import {
  FIELD_MAP,
  MAPPING_CLASSES,
  MAPPING_CLASS_LABELS,
  fieldMapCsv,
  fieldMapMarkdown,
  fieldMapSummary,
  type MappingClass,
} from "@/lib/electrical-field-map";

export const Route = createFileRoute("/electrical/mapping")({
  component: MappingPage,
  head: () => ({
    meta: [
      { title: "Electrical Field Mapping Matrix — Bostead Farms" },
      {
        name: "description",
        content:
          "Phase 4.3 coverage matrix mapping every canonical electrical workbook field onto normalized FarmOps entities, with authority and transformation.",
      },
      { property: "og:title", content: "Electrical Field Mapping Matrix — Bostead Farms" },
      {
        property: "og:description",
        content: "Which ODS engineering fields are mapped, derived, display-only, obsolete or excluded.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const CLASS_VARIANT: Record<MappingClass, "default" | "secondary" | "outline" | "destructive"> = {
  directly_mapped: "default",
  derived: "secondary",
  display_only: "outline",
  obsolete: "destructive",
  intentionally_excluded: "outline",
};

function MappingPage() {
  const [search, setSearch] = useState("");
  const [only, setOnly] = useState<MappingClass | "">("");
  const summary = useMemo(() => fieldMapSummary(), []);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return FIELD_MAP.filter(
      (r) =>
        (!only || r.classification === only) &&
        (!needle ||
          `${r.worksheet} ${r.field} ${r.farmops} ${r.transformation}`
            .toLowerCase()
            .includes(needle)),
    );
  }, [search, only]);

  return (
    <ElectricalGate>
      <div className="space-y-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Phase 4.3 field mapping matrix</CardTitle>
            <p className="text-sm text-muted-foreground">
              Engineering authority remains the canonical workbook{" "}
              <span className="font-mono">{CANONICAL_ODS_PATH}</span>. FarmOps owns field /
              as-built observations. {summary.total} fields across {summary.worksheets.length}{" "}
              worksheets are classified below.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {MAPPING_CLASSES.map((c) => (
                <Button
                  key={c}
                  size="sm"
                  variant={only === c ? "default" : "outline"}
                  onClick={() => setOnly(only === c ? "" : c)}
                >
                  {MAPPING_CLASS_LABELS[c]} · {summary.byClass[c]}
                </Button>
              ))}
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() =>
                  download("electrical-field-mapping.csv", fieldMapCsv(), "text/csv")
                }
              >
                <Download className="h-4 w-4" />
                CSV
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() =>
                  download(
                    "electrical-field-mapping.md",
                    fieldMapMarkdown(),
                    "text/markdown",
                  )
                }
              >
                <Download className="h-4 w-4" />
                Markdown
              </Button>
            </div>
            <Input
              placeholder="Filter by worksheet, field or FarmOps column…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="p-2">Worksheet</th>
                  <th className="p-2">Field</th>
                  <th className="p-2">Classification</th>
                  <th className="p-2">FarmOps location</th>
                  <th className="p-2">Authority</th>
                  <th className="p-2">Transformation</th>
                  <th className="p-2">Coverage</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.worksheet}-${r.field}-${i}`} className="border-t border-border">
                    <td className="p-2 whitespace-nowrap">{r.worksheet}</td>
                    <td className="p-2">{r.field}</td>
                    <td className="p-2">
                      <Badge variant={CLASS_VARIANT[r.classification]}>
                        {MAPPING_CLASS_LABELS[r.classification]}
                      </Badge>
                    </td>
                    <td className="p-2 font-mono text-xs">{r.farmops}</td>
                    <td className="p-2 whitespace-nowrap text-muted-foreground">{r.authority}</td>
                    <td className="p-2 text-muted-foreground">{r.transformation}</td>
                    <td className="p-2 whitespace-nowrap">{r.coverage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </ElectricalGate>
  );
}
