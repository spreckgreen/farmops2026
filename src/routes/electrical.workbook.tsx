// Electrician's field workbook: one printable snapshot of every electrical data
// tab plus naming standards and generated topology diagrams. Read-only view —
// nothing on this page writes an electrical record.
import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { WorkbookExportButton } from "@/components/electrical/workbook-export-button";
import { electricalWorkbookData } from "@/lib/electrical-workbook.functions";
import { generateElectricalDiagram } from "@/lib/electrical-diagrams.functions";
import { buildWorkbook } from "@/lib/electrical-workbook";
import { DIAGRAM_LABELS, type DiagramType } from "@/lib/electrical-mermaid";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Printer } from "lucide-react";

const WORKBOOK_DIAGRAMS: DiagramType[] = [
  "whole_system",
  "site",
  "critical_power",
  "raceway",
  "power_dependency",
];

export const Route = createFileRoute("/electrical/workbook")({
  component: WorkbookPage,
  head: () => ({
    meta: [
      { title: "Electrical Field Workbook — Bostead Farms" },
      {
        name: "description",
        content:
          "Printable electrician's workbook: panels, feeders, raceways, junction boxes, branch runs, loads, services, naming standards and topology diagrams.",
      },
      { property: "og:title", content: "Electrical Field Workbook — Bostead Farms" },
      {
        property: "og:description",
        content:
          "One printable snapshot of the as-installed electrical record, with Word export for the electrician.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

const PRINT_CSS = `
@media print {
  body:has(.electrical-workbook) header,
  body:has(.electrical-workbook) nav,
  body:has(.electrical-workbook) .workbook-no-print { display: none !important; }
  body:has(.electrical-workbook) .electrical-workbook { max-width: none; padding: 0; }
  .workbook-section { break-inside: avoid; page-break-inside: avoid; }
  .workbook-section table { font-size: 9px; }
  .workbook-figure { break-inside: avoid; page-break-inside: avoid; }
  @page { size: letter landscape; margin: 0.5in; }
}
`;

function WorkbookPage() {
  return (
    <ElectricalGate>
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <Workbook />
    </ElectricalGate>
  );
}

/** Renders one Mermaid diagram and hands the SVG up for the DOCX export. */
function MermaidFigure({
  type,
  onSvg,
}: {
  type: DiagramType;
  onSvg: (type: DiagramType, svg: string, mermaid: string) => void;
}) {
  const fetcher = useServerFn(generateElectricalDiagram);
  const q = useQuery({
    queryKey: ["electrical", "workbook", "diagram", type],
    queryFn: () => fetcher({ data: { type, state: "all" } }),
  });
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const source = q.data?.mermaid ?? "";

  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    (async () => {
      try {
        const mod = (await import(/* @vite-ignore */ "https://esm.sh/mermaid@11.17.2")) as {
          default?: unknown;
        };
        const mermaid = (mod.default ?? mod) as {
          initialize: (c: Record<string, unknown>) => void;
          render: (id: string, src: string) => Promise<{ svg: string }>;
        };
        mermaid.initialize({ startOnLoad: false, theme: "neutral" });
        const out = await mermaid.render(`wb-${type}-${Date.now()}`, source);
        if (cancelled) return;
        setSvg(out.svg);
        onSvg(type, out.svg, source);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, type]);

  return (
    <div className="workbook-figure space-y-1">
      <h3 className="text-sm font-semibold">{DIAGRAM_LABELS[type]}</h3>
      {q.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : q.error ? (
        <p className="text-sm text-destructive">{(q.error as Error).message}</p>
      ) : error ? (
        <pre className="text-[10px] overflow-x-auto rounded-md border border-border p-2">
          {source}
        </pre>
      ) : svg ? (
        <div
          className="rounded-md border border-border bg-card p-2 overflow-x-auto [&_svg]:max-w-full [&_svg]:h-auto"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <Skeleton className="h-40 w-full" />
      )}
    </div>
  );
}

function Workbook() {
  const fetcher = useServerFn(electricalWorkbookData);
  const q = useQuery({
    queryKey: ["electrical", "workbook"],
    queryFn: () => fetcher(),
  });
  const [figures, setFigures] = useState<
    Record<string, { title: string; mermaid: string; svg: string }>
  >({});

  const workbook = useMemo(
    () => (q.data ? buildWorkbook(q.data) : null),
    [q.data],
  );

  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  if (q.error)
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive">
          {(q.error as Error).message}
        </CardContent>
      </Card>
    );
  if (!workbook) return null;

  const diagrams = WORKBOOK_DIAGRAMS.map((type) => ({
    key: type,
    title: DIAGRAM_LABELS[type],
    mermaid: figures[type]?.mermaid ?? "",
    svg: figures[type]?.svg,
  })).filter((d) => d.mermaid || d.svg);

  return (
    <div className="electrical-workbook space-y-4">
      <Card className="workbook-no-print">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Electrician's field workbook</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            One printable snapshot of every electrical data tab, the naming standards and the
            generated topology diagrams. It is a view over the records — printing or exporting
            never changes data, and the engineering spreadsheet stays the release authority.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => window.print()}>
              <Printer className="h-4 w-4 mr-1.5" />
              Print / save PDF
            </Button>
            <WorkbookExportButton workbook={workbook} diagrams={diagrams} />
            <Badge variant="secondary">{workbook.total_records} records</Badge>
            <span className="text-xs">
              Generated {workbook.generated_at.replace("T", " ").slice(0, 19)} UTC
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight">{workbook.title}</h2>
        <p className="text-xs text-muted-foreground">
          As-installed field record · generated {workbook.generated_at.replace("T", " ").slice(0, 19)}{" "}
          UTC · stable IDs are permanent and must never be renamed or renumbered.
        </p>
      </div>

      {workbook.sections.map((section) => (
        <Card key={section.key} className="workbook-section">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              {section.title}
              <Badge variant="outline">{section.count}</Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground">{section.description}</p>
          </CardHeader>
          <CardContent>
            {section.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No records.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-muted">
                      {section.columns.map((c) => (
                        <th
                          key={c.key}
                          className="border border-border px-2 py-1 text-left font-semibold"
                        >
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {section.rows.map((row, i) => (
                      <tr key={i}>
                        {row.map((value, j) => (
                          <td key={j} className="border border-border px-2 py-1 align-top">
                            {value}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      <Card className="workbook-section">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Topology diagrams</CardTitle>
          <p className="text-xs text-muted-foreground">
            Generated from the same records — never hand-maintained drawings.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {WORKBOOK_DIAGRAMS.map((type) => (
            <MermaidFigure
              key={type}
              type={type}
              onSvg={(t, svg, mermaid) =>
                setFigures((prev) =>
                  prev[t]?.svg === svg
                    ? prev
                    : { ...prev, [t]: { title: DIAGRAM_LABELS[t], mermaid, svg } },
                )
              }
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
