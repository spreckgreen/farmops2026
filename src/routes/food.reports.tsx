import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Download, Printer, RefreshCw } from "lucide-react";
import { z } from "zod";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { getFoodReports } from "@/lib/food-reports.functions";
import { downloadCsv } from "@/lib/csv";
import { reportCsv, reportMarkdownFile, type FoodReport } from "@/lib/food-reports";
import { ReportView } from "@/components/report-view";

const searchSchema = z.object({
  report: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/food/reports")({
  validateSearch: zodValidator(searchSchema),
  head: () => ({ meta: [{ title: "Food Reports — Bostead Farms" }] }),
  component: FoodReportsPage,
});

function downloadText(filename: string, text: string, mime = "text/markdown;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function syncReportToObsidian(report: FoodReport): Promise<"ok" | "unsupported" | "cancelled" | "error"> {
  const w = window as unknown as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> };
  if (typeof window === "undefined" || !w.showDirectoryPicker) return "unsupported";
  try {
    const root = await w.showDirectoryPicker();
    let vault: FileSystemDirectoryHandle;
    try {
      vault = await root.getDirectoryHandle("BosteadFarms", { create: false });
    } catch {
      vault = await root.getDirectoryHandle("BosteadFarms", { create: true });
    }
    const parts = report.obsidianPath.split("/");
    let dir: FileSystemDirectoryHandle = vault;
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i], { create: true });
    }
    const file = await dir.getFileHandle(parts[parts.length - 1], { create: true });
    const writable = await file.createWritable();
    await writable.write(reportMarkdownFile(report));
    await writable.close();
    return "ok";
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === "AbortError") return "cancelled";
    console.error(err);
    return "error";
  }
}

function FoodReportsPage() {
  const { report } = Route.useSearch();
  const navigate = useNavigate({ from: Route.id });
  const reportsFn = useServerFn(getFoodReports);
  const reportsQ = useQuery({
    queryKey: ["food-reports"],
    queryFn: () => reportsFn(),
  });
  const reports = reportsQ.data?.reports ?? [];
  const current = reports.find((r) => r.slug === report) ?? reports[0];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3 no-print">
        <div>
          <h2 className="text-xl font-mono font-semibold">Food Reports</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Pre-built reports derived from your food plan, storage, harvests, and garden. Preview, print, download, or sync to your Obsidian vault.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => reportsQ.refetch()}
          disabled={reportsQ.isFetching}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${reportsQ.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {reportsQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading reports…</p>
      ) : reportsQ.isError ? (
        <p className="text-sm text-destructive">Failed to load reports.</p>
      ) : reports.length === 0 ? (
        <p className="text-sm text-muted-foreground">No reports available.</p>
      ) : (
        <Tabs
          value={current?.slug}
          onValueChange={(slug) => navigate({ search: { report: slug } })}
          className="space-y-4"
        >
          <TabsList className="no-print flex flex-wrap h-auto">
            {reports.map((r) => (
              <TabsTrigger key={r.slug} value={r.slug} className="text-xs">
                {r.title}
              </TabsTrigger>
            ))}
          </TabsList>

          {reports.map((r) => (
            <TabsContent key={r.slug} value={r.slug} className="mt-0">
              <div className="flex flex-wrap gap-2 mb-3 no-print">
                <Button size="sm" variant="outline" onClick={() => window.print()}>
                  <Printer className="h-4 w-4 mr-1" /> Print
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => downloadText(`${r.slug}.md`, reportMarkdownFile(r))}
                >
                  <Download className="h-4 w-4 mr-1" /> Markdown
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => downloadCsv(`${r.slug}.csv`, reportCsv(r))}
                >
                  <Download className="h-4 w-4 mr-1" /> CSV
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    const result = await syncReportToObsidian(r);
                    if (result === "ok") toast.success(`Wrote ${r.obsidianPath} to vault`);
                    else if (result === "unsupported")
                      toast.error("Your browser doesn't support folder picking. Use Download instead.");
                    else if (result === "error") toast.error("Failed to write to vault");
                  }}
                >
                  Sync to Obsidian
                </Button>
                <span className="text-[10px] text-muted-foreground font-mono self-center ml-auto">
                  Vault: BosteadFarms/{r.obsidianPath}
                </span>
              </div>

              <Card className="report-print-root p-6 sm:p-10 bg-card print:bg-white print:shadow-none print:border-0 print:p-0">
                <ReportView markdown={r.markdown} />
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}
