import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Download, Eye, FileText, RefreshCw } from "lucide-react";
import { getFoodReports } from "@/lib/food-reports.functions";
import { downloadCsv } from "@/lib/csv";
import { reportCsv, reportMarkdownFile, type FoodReport } from "@/lib/food-reports";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/food/reports")({
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
    // Ensure VAULT_ROOT exists; create if missing.
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
  const reportsFn = useServerFn(getFoodReports);
  const [rowLengthFt] = useState(30);
  const reportsQ = useQuery({
    queryKey: ["food-reports", rowLengthFt],
    queryFn: () => reportsFn(),
  });
  const reports = reportsQ.data?.reports ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-mono font-semibold">Food Reports</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Pre-built reports derived from your food plan, storage, harvests, and garden. Each one can be previewed, downloaded as markdown or CSV, or synced into your Obsidian vault.
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
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {reports.map((r) => (
            <ReportCard key={r.slug} report={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReportCard({ report }: { report: FoodReport }) {
  const [open, setOpen] = useState(false);
  const previewLines = useMemo(() => report.markdown.split("\n").slice(0, 30).join("\n"), [report.markdown]);

  const baseName = report.slug;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-mono text-base flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          {report.title}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{report.description}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <pre className="text-xs bg-muted rounded p-3 overflow-hidden max-h-40 font-mono">
{previewLines}
        </pre>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Eye className="h-4 w-4 mr-1" /> Preview
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => downloadText(`${baseName}.md`, reportMarkdownFile(report))}
          >
            <Download className="h-4 w-4 mr-1" /> Markdown
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => downloadCsv(`${baseName}.csv`, reportCsv(report))}
          >
            <Download className="h-4 w-4 mr-1" /> CSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              const result = await syncReportToObsidian(report);
              if (result === "ok") toast.success(`Wrote ${report.obsidianPath} to vault`);
              else if (result === "unsupported")
                toast.error("Your browser doesn't support folder picking. Use Download instead.");
              else if (result === "error") toast.error("Failed to write to vault");
            }}
          >
            Sync to Obsidian
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground font-mono">
          Vault path: BosteadFarms/{report.obsidianPath}
        </p>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{report.title}</DialogTitle>
            <DialogDescription>{report.description}</DialogDescription>
          </DialogHeader>
          <pre className="text-xs whitespace-pre-wrap font-mono">{report.markdown}</pre>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// silence unused warning for Input/Label kept for future row-length control
void Input; void Label;
