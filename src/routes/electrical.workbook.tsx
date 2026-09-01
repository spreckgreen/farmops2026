// Electrician's field workbook: one printable snapshot of every electrical data
// tab plus naming standards. Topology diagrams live on their own page
// (/electrical/topology). Read-only view — nothing here writes a record.
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { WorkbookExportButton } from "@/components/electrical/workbook-export-button";
import { electricalWorkbookData } from "@/lib/electrical-workbook.functions";
import { buildWorkbook, tidyWorkbook, type WorkbookSection } from "@/lib/electrical-workbook";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ChevronDown, Network, Printer } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/electrical/workbook")({
  component: WorkbookPage,
  head: () => ({
    meta: [
      { title: "Electrical Field Workbook — Bostead Farms" },
      {
        name: "description",
        content:
          "Printable electrician's workbook: panels, feeders, raceways, junction boxes, branch runs, loads, services and naming standards.",
      },
      { property: "og:title", content: "Electrical Field Workbook — Bostead Farms" },
      {
        property: "og:description",
        content:
          "One printable snapshot of the as-installed electrical record, with tidy and full Word exports for the electrician.",
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

/** One entity table that can be closed to keep attention on the work area. */
function SectionCard({
  section,
  open,
  onToggle,
}: {
  section: WorkbookSection;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <Card className="workbook-section">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full flex-wrap items-center gap-2 px-6 py-3 text-left"
      >
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open ? "" : "-rotate-90",
          )}
        />
        <span className="text-base font-semibold">{section.title}</span>
        <Badge variant="outline">{section.count}</Badge>
        <span className="w-full pl-6 text-xs text-muted-foreground">{section.description}</span>
      </button>
      {open ? (
        <CardContent className="pt-0">
          {section.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No records.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
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
      ) : null}
    </Card>
  );
}

function Workbook() {
  const fetcher = useServerFn(electricalWorkbookData);
  const q = useQuery({
    queryKey: ["electrical", "workbook"],
    queryFn: () => fetcher(),
  });
  const [tidy, setTidy] = useState(false);
  const [closed, setClosed] = useState<Record<string, boolean>>({});

  const workbook = useMemo(() => {
    if (!q.data) return null;
    const built = buildWorkbook(q.data);
    return tidy ? tidyWorkbook(built) : built;
  }, [q.data, tidy]);

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

  const setAll = (open: boolean) =>
    setClosed(Object.fromEntries(workbook.sections.map((s) => [s.key, !open])));

  return (
    <div className="electrical-workbook space-y-4">
      <Card className="workbook-no-print">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Electrician's field workbook</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            One printable snapshot of every electrical data tab and the naming standards. Open and
            close tables to focus on one work area. It is a view over the records — printing or
            exporting never changes data, and the engineering spreadsheet stays the release
            authority.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => window.print()}>
              <Printer className="mr-1.5 h-4 w-4" />
              Print / save PDF
            </Button>
            <WorkbookExportButton workbook={workbook} tidy={tidy} />
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={tidy} onCheckedChange={setTidy} />
              Tidy format
            </label>
            <Button size="sm" variant="ghost" onClick={() => setAll(true)}>
              Open all
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAll(false)}>
              Close all
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link to="/electrical/topology">
                <Network className="mr-1.5 h-4 w-4" />
                Topology pack
              </Link>
            </Button>
            <Badge variant="secondary">{workbook.total_records} records</Badge>
            <span className="text-xs">
              Generated {workbook.generated_at.replace("T", " ").slice(0, 19)} UTC
            </span>
          </div>
          {tidy ? (
            <p className="text-xs">
              Tidy format keeps the key columns per table and drops empty tables — best for a
              printed field notebook. Turn it off for the complete record.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight">{workbook.title}</h2>
        <p className="text-xs text-muted-foreground">
          As-installed field record · generated{" "}
          {workbook.generated_at.replace("T", " ").slice(0, 19)} UTC · stable IDs are permanent and
          must never be renamed or renumbered.
        </p>
      </div>

      {workbook.sections.map((section) => (
        <SectionCard
          key={section.key}
          section={section}
          open={!closed[section.key]}
          onToggle={() => setClosed((prev) => ({ ...prev, [section.key]: !prev[section.key] }))}
        />
      ))}
    </div>
  );
}
