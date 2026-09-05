// Document generation: build the Farm Shop electrical sheet, the Avery 8593
// label sheets and the Farm Shop grid map as PDFs from one API call to
// GET /api/electrical/v1/documents/bundle.
//
// Every file carries an embedded version stamp — document format version, API
// and snapshot schema version, snapshot timestamp, scope, record counts, QA
// totals and a content digest — printed on the cover, repeated in the footer of
// every page, written into the PDF metadata and encoded in the filename. The
// verifier on this screen answers "is the print in my hand still the truth?".
import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Archive,
  CheckCircle2,
  FileDown,
  FileText,
  Grid3x3,
  History,
  RefreshCw,
  Tag,
  TriangleAlert,
  Upload,
} from "lucide-react";

import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { getElectricalDocumentBundle } from "@/lib/electrical-documents.functions";
import {
  ALL_SCOPE,
  DEFAULT_SCOPE,
  buildGridMapModel,
  buildLabelModel,
  buildSheetModel,
  buildingOptions,
  panelOptionsFor,
  scopeLabel,
  type DocScope,
} from "@/lib/electrical-documents";
import {
  DOC_FORMAT_VERSIONS,
  DOC_TYPE_LABEL,
  buildVersionStamp,
  stampFileName,
  verifyVersionCode,
  type DocType,
  type VersionStamp,
} from "@/lib/electrical-doc-version";
import {
  buildVersionedBundleFile,
  parseVersionedBundleFile,
  verifyVersionedBundleFile,
  versionedBundleFileName,
  type BundleIntegrity,
  type VersionedBundleFile,
} from "@/lib/electrical-bundle-version";
import {
  clearDocVersionHistory,
  docVersionHistory,
  historyCsv,
  recordDocVersion,
  type DocVersionHistoryEntry,
} from "@/lib/electrical-doc-history";
import { LABEL_KINDS, type LabelKind } from "@/lib/electrical-labels";
import { ENTITIES } from "@/lib/electrical-entities";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/electrical/documents")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  component: ElectricalDocumentsPage,
  head: () => ({
    meta: [
      { title: "Electrical Documents — Bostead Farms" },
      {
        name: "description",
        content:
          "Generate the Farm Shop electrical sheet, Avery 8593 labels and grid map as PDFs from the FarmOps Electrical API, each with an embedded version stamp.",
      },
      { property: "og:title", content: "Electrical Documents — Bostead Farms" },
      {
        property: "og:description",
        content:
          "Versioned PDF output for the Farm Shop electrical sheet, labels and grid map, generated from the FarmOps Electrical API.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

const DEFAULT_LABEL_KINDS: LabelKind[] = ["load", "panel", "circuit_group"];

function ElectricalDocumentsPage() {
  return (
    <ElectricalGate>
      <DocumentsWorkspace />
    </ElectricalGate>
  );
}

function DocumentsWorkspace() {
  const fetchBundle = useServerFn(getElectricalDocumentBundle);
  const [scope, setScope] = useState<DocScope>(DEFAULT_SCOPE);
  const [labelKinds, setLabelKinds] = useState<LabelKind[]>(DEFAULT_LABEL_KINDS);
  const [busy, setBusy] = useState<DocType | null>(null);
  const [lastStamps, setLastStamps] = useState<Partial<Record<DocType, VersionStamp>>>({});
  const [pasted, setPasted] = useState("");
  // A loaded capture replaces the live snapshot as the source of truth for
  // every document on this screen, so a reprint reproduces the original version.
  const [captured, setCaptured] = useState<{
    file: VersionedBundleFile;
    fileName: string;
    integrity: BundleIntegrity;
  } | null>(null);
  const [history, setHistory] = useState<DocVersionHistoryEntry[]>([]);

  useEffect(() => {
    setHistory(docVersionHistory());
  }, []);

  const query = useQuery({
    queryKey: ["electrical-document-bundle"],
    queryFn: () => fetchBundle(),
    staleTime: 60_000,
  });

  const live = query.data ?? null;
  const bundle = captured ? captured.file.bundle : (live?.bundle ?? null);
  const apiVersion = captured ? captured.file.api_version : (live?.apiVersion ?? "");
  const generatedBy = live?.generatedBy ?? "";
  const source = captured
    ? ({ kind: "captured-bundle", label: captured.file.bundle_version_code } as const)
    : ({ kind: "live", label: "live snapshot" } as const);

  const buildings = useMemo(() => (bundle ? buildingOptions(bundle) : []), [bundle]);
  const panels = useMemo(
    () => (bundle ? panelOptionsFor(bundle, scope.building) : []),
    [bundle, scope.building],
  );

  const models = useMemo(() => {
    if (!bundle) return null;
    return {
      sheet: buildSheetModel(bundle, scope),
      labels: buildLabelModel(bundle, labelKinds, scope),
      map: buildGridMapModel(bundle, scope),
    };
  }, [bundle, scope, labelKinds]);

  async function stampFor(docType: DocType, counts: Record<string, number>, records: unknown) {
    if (!bundle) throw new Error("No bundle loaded.");
    return buildVersionStamp(
      {
        docType,
        apiVersion,
        schemaVersion: bundle.schema_version,
        generatedAt: bundle.generated_at,
        counts,
        qaErrors: bundle.qa.errors,
        qaWarnings: bundle.qa.warnings,
        generatedBy: generatedBy || captured?.file.captured_by || "unknown",
        printedAt: new Date().toISOString(),
        scope: scopeLabel(scope),
        bundleSource: captured
          ? `captured bundle ${captured.file.bundle_version_code} (${captured.fileName}, digest ${captured.integrity})`
          : "live snapshot",
      },
      records,
    );
  }

  /** Save the current live snapshot as a versioned bundle file for later reprints. */
  async function captureBundle() {
    if (!live) return;
    try {
      const file = await buildVersionedBundleFile(live.bundle, {
        apiVersion: live.apiVersion,
        capturedBy: live.generatedBy,
      });
      const name = versionedBundleFileName(file);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Bundle version captured", { description: name });
    } catch (err) {
      toast.error("Could not capture the bundle", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function loadCapturedBundle(fileInput: File) {
    try {
      const text = await fileInput.text();
      const parsed = parseVersionedBundleFile(text);
      const { status } = await verifyVersionedBundleFile(parsed);
      setCaptured({ file: parsed, fileName: fileInput.name, integrity: status });
      setScope(DEFAULT_SCOPE);
      if (status === "digest-mismatch") {
        toast.warning("Bundle loaded, digest does not match", {
          description: "The capture was altered after it was written. Documents will say so.",
        });
      } else {
        toast.success("Versioned bundle loaded", { description: parsed.bundle_version_code });
      }
    } catch (err) {
      toast.error("Could not read that bundle", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function generate(docType: DocType) {
    if (!models || !bundle) return;
    setBusy(docType);
    try {
      const pdf = await import("@/lib/electrical-pdf");
      let stamp: VersionStamp;
      let doc: ReturnType<typeof pdf.renderSheetPdf>;
      if (docType === "farm-shop-sheet") {
        stamp = await stampFor(docType, models.sheet.counts, models.sheet.digestSource);
        doc = pdf.renderSheetPdf(models.sheet, stamp);
      } else if (docType === "avery-labels") {
        stamp = await stampFor(
          docType,
          { labels: models.labels.total, blocks: models.labels.groups.length },
          models.labels.digestSource,
        );
        doc = pdf.renderLabelsPdf(models.labels, stamp);
      } else {
        stamp = await stampFor(
          docType,
          {
            plotted: models.map.summary.placed,
            unplaced: models.map.summary.unplaced,
            total: models.map.summary.total,
          },
          models.map.digestSource,
        );
        // Print the same plan drawing the screen shows, so a printed dot lands
        // where the on-screen dot lands.
        const planImage = await pdf.loadPlanImage();
        doc = pdf.renderGridMapPdf(models.map, stamp, planImage, { postsOnly: gridPostsOnly });
      }
      const name = pdf.savePdf(doc, stamp);
      setLastStamps((prev) => ({ ...prev, [docType]: stamp }));
      recordDocVersion(stamp, source, name);
      setHistory(docVersionHistory());
      toast.success(`${DOC_TYPE_LABEL[docType]} generated`, { description: name });
    } catch (err) {
      toast.error("Could not generate the document", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  }


  const toggleKind = (kind: LabelKind) =>
    setLabelKinds((prev) =>
      prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind],
    );

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Document generation</h1>
        <p className="text-muted-foreground max-w-3xl text-sm">
          Every document is built from one read of{" "}
          <code className="text-xs">GET /api/electrical/v1/documents/bundle</code> and carries an
          embedded version stamp, so anyone holding a printed sheet can prove which version of the
          truth it shows. Absent values print <strong>NOT IN RECORD</strong> — nothing is inferred.
        </p>
      </header>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">Source</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={captureBundle} disabled={!live}>
              <Archive className="mr-2 size-4" />
              Capture bundle version
            </Button>
            <Button variant="outline" size="sm" asChild>
              <label className="cursor-pointer">
                <Upload className="mr-2 size-4" />
                Load versioned bundle
                <input
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void loadCapturedBundle(f);
                  }}
                />
              </label>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => query.refetch()}
              disabled={query.isFetching}
            >
              <RefreshCw className={query.isFetching ? "mr-2 size-4 animate-spin" : "mr-2 size-4"} />
              Re-read API
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {captured ? (
            <div className="border-border bg-muted/40 space-y-1 rounded-md border p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="font-mono text-[10px]">
                  {captured.file.bundle_version_code}
                </Badge>
                <Badge
                  variant={captured.integrity === "verified" ? "outline" : "destructive"}
                  className="text-[10px]"
                >
                  {captured.integrity === "verified"
                    ? "digest verified"
                    : captured.integrity === "digest-mismatch"
                      ? "digest MISMATCH — capture altered"
                      : "no digest in capture"}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => {
                    setCaptured(null);
                    setScope(DEFAULT_SCOPE);
                  }}
                >
                  Return to live snapshot
                </Button>
              </div>
              <p className="text-muted-foreground break-all">
                Printing from captured bundle <span className="font-mono">{captured.fileName}</span>{" "}
                — snapshot {captured.file.generated_at}, captured {captured.file.captured_at || "—"}{" "}
                by {captured.file.captured_by || "—"}. Documents stamp this snapshot version, not the
                live one.
              </p>
            </div>
          ) : null}

          {query.isLoading && !captured ? (
            <Skeleton className="h-24 w-full" />
          ) : query.error && !captured ? (
            <p className="text-destructive text-sm">
              {query.error instanceof Error ? query.error.message : "Could not read the API bundle."}
            </p>
          ) : bundle ? (
            <>
              <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Bundle source" value={captured ? "Captured version" : "Live snapshot"} />
                <Field label="API version" value={apiVersion || "unknown"} />
                <Field label="Snapshot schema" value={bundle.schema_version} />
                <Field label="Snapshot generated" value={bundle.generated_at} />
                <Field
                  label="QA"
                  value={`${bundle.qa.errors} errors · ${bundle.qa.warnings} warnings`}
                />
              </dl>

              {/* Record counts, so it is obvious at a glance whether the read
                  returned data before anything is printed. */}
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(bundle.counts ?? {})
                  .filter(([, n]) => typeof n === "number")
                  .sort((a, b) => b[1] - a[1])
                  .map(([name, n]) => (
                    <Badge key={name} variant={n ? "secondary" : "outline"} className="text-[10px]">
                      {name.replace(/_/g, " ")}: {n}
                    </Badge>
                  ))}
              </div>

              <Separator />


              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Building / area</Label>
                  <Select
                    value={scope.building}
                    onValueChange={(v) => setScope({ building: v, panel: ALL_SCOPE })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_SCOPE}>All buildings</SelectItem>
                      {buildings.map((b) => (
                        <SelectItem key={b} value={b}>
                          {b}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Panel</Label>
                  <Select
                    value={scope.panel}
                    onValueChange={(v) => setScope((s) => ({ ...s, panel: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_SCOPE}>All panels</SelectItem>
                      {panels.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      {models ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <DocCard
            icon={<FileText className="size-4" />}
            title="Farm Shop electrical sheet"
            docType="farm-shop-sheet"
            summary={[
              `${models.sheet.counts["loads"]} loads`,
              `${models.sheet.counts["panels"]} panels`,
              `${models.sheet.counts["circuit_groups"]} circuits`,
              `${models.sheet.counts["unresolved_panel"]} loads with no panel in the record`,
              `${models.sheet.counts["gap_cells"]} NOT IN RECORD cells printed as gaps`,
            ]}
            busy={busy}
            stamp={lastStamps["farm-shop-sheet"]}
            onGenerate={generate}
          />

          <DocCard
            icon={<Tag className="size-4" />}
            title="Avery 8593 labels"
            docType="avery-labels"
            summary={[
              `${models.labels.total} labels`,
              `${models.labels.groups.length} print blocks (location, then panel)`,
              "Each block starts a fresh sheet so labels land in the right slots",
              "Right column: grid on line 1, volts/amps + D or S on line 2",
            ]}
            busy={busy}
            stamp={lastStamps["avery-labels"]}
            onGenerate={generate}
          >
            <div className="flex flex-wrap gap-1.5 pt-1">
              {LABEL_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => toggleKind(kind)}
                  className={
                    labelKinds.includes(kind)
                      ? "bg-primary text-primary-foreground rounded-md px-2 py-0.5 text-xs"
                      : "bg-muted text-muted-foreground rounded-md px-2 py-0.5 text-xs"
                  }
                >
                  {ENTITIES[kind].title}
                </button>
              ))}
            </div>
          </DocCard>

          <DocCard
            icon={<Grid3x3 className="size-4" />}
            title="Farm Shop grid map"
            docType="grid-map"
            summary={[
              `${models.map.summary.placed} of ${models.map.summary.total} loads plotted`,
              `${models.map.summary.counts["LARGE_DEDICATED"]} large dedicated (red)`,
              `${models.map.summary.counts["DEDICATED_20A"]} dedicated 20A (orange)`,
              `${models.map.summary.counts["SHARED"]} shared (blue)`,
              `${models.map.unplaced.length} unplaced loads listed, never estimated`,
              `Grid cells A1–F9 plus ${models.map.poles.length} Pole Barn post references`,
              gridPostsOnly
                ? "Clean plan: drawing, posts and grid references only — no load markers or load tables"
                : "Full map: load markers, grid/post cross-reference and unplaced list",
            ]}
            busy={busy}
            stamp={lastStamps["grid-map"]}
            onGenerate={generate}
          >
            {/* Print option only: the records are untouched either way. */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => setGridPostsOnly(false)}
                className={
                  gridPostsOnly
                    ? "bg-muted text-muted-foreground rounded-md px-2 py-0.5 text-xs"
                    : "bg-primary text-primary-foreground rounded-md px-2 py-0.5 text-xs"
                }
              >
                Full map with loads
              </button>
              <button
                type="button"
                onClick={() => setGridPostsOnly(true)}
                className={
                  gridPostsOnly
                    ? "bg-primary text-primary-foreground rounded-md px-2 py-0.5 text-xs"
                    : "bg-muted text-muted-foreground rounded-md px-2 py-0.5 text-xs"
                }
              >
                Clean plan — posts only
              </button>
            </div>
          </DocCard>
        </div>
      ) : null}

      <LabelVersionHistory
        entries={history.filter((e) => e.docType === "avery-labels")}
        onClear={() => {
          clearDocVersionHistory("avery-labels");
          setHistory(docVersionHistory());
        }}
      />



      {models ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Verify a printed document</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-muted-foreground text-sm">
              Type the version code from the footer of a printed sheet (for example{" "}
              <code className="text-xs">FS-SHEET-1.0-9F3A21C7</code>) to check it against the
              records as they stand right now, for the scope selected above.
            </p>
            <div className="flex flex-wrap gap-2">
              <Input
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder="FS-SHEET-1.0-…"
                className="max-w-xs font-mono text-xs"
              />
            </div>
            <VerifyResultView
              pasted={pasted}
              onCurrent={async (docType) => {
                if (docType === "farm-shop-sheet")
                  return (await stampFor(docType, models.sheet.counts, models.sheet.digestSource))
                    .versionCode;
                if (docType === "avery-labels")
                  return (
                    await stampFor(
                      docType,
                      { labels: models.labels.total, blocks: models.labels.groups.length },
                      models.labels.digestSource,
                    )
                  ).versionCode;
                return (
                  await stampFor(
                    docType,
                    {
                      plotted: models.map.summary.placed,
                      unplaced: models.map.summary.unplaced,
                      total: models.map.summary.total,
                    },
                    models.map.digestSource,
                  )
                ).versionCode;
              }}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs uppercase tracking-wide">{label}</dt>
      <dd className="font-mono text-xs break-all">{value}</dd>
    </div>
  );
}

function DocCard({
  icon,
  title,
  docType,
  summary,
  busy,
  stamp,
  onGenerate,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  docType: DocType;
  summary: string[];
  busy: DocType | null;
  stamp?: VersionStamp;
  onGenerate: (t: DocType) => void;
  children?: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="space-y-1">
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
        </CardTitle>
        <Badge variant="outline" className="w-fit font-mono text-[10px]">
          format v{DOC_FORMAT_VERSIONS[docType]}
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <ul className="text-muted-foreground space-y-1 text-sm">
          {summary.map((s) => (
            <li key={s}>· {s}</li>
          ))}
        </ul>
        {children}
        <div className="mt-auto space-y-2 pt-2">
          <Button className="w-full" onClick={() => onGenerate(docType)} disabled={busy !== null}>
            <FileDown className="mr-2 size-4" />
            {busy === docType ? "Generating…" : "Generate PDF"}
          </Button>
          {stamp ? (
            <div className="text-muted-foreground space-y-1 text-xs">
              <p className="font-mono break-all">{stamp.versionCode}</p>
              <p className="break-all">{stampFileName(stamp, "pdf")}</p>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function VerifyResultView({
  pasted,
  onCurrent,
}: {
  pasted: string;
  onCurrent: (docType: DocType) => Promise<string>;
}) {
  const [result, setResult] = useState<{ status: string; message: string } | null>(null);
  const [checking, setChecking] = useState(false);

  const docTypeFor = (code: string): DocType | null => {
    const up = code.trim().toUpperCase();
    if (up.startsWith("FS-SHEET")) return "farm-shop-sheet";
    if (up.startsWith("FS-LABEL")) return "avery-labels";
    if (up.startsWith("FS-MAP")) return "grid-map";
    return null;
  };

  async function check() {
    const docType = docTypeFor(pasted);
    if (!docType) {
      setResult({
        status: "unknown",
        message:
          "That code does not name a known document type. Codes start with FS-SHEET, FS-LABEL or FS-MAP.",
      });
      return;
    }
    setChecking(true);
    try {
      const current = await onCurrent(docType);
      setResult(verifyVersionCode(pasted, current));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button variant="outline" size="sm" onClick={check} disabled={checking || !pasted.trim()}>
        {checking ? "Checking…" : "Check this print"}
      </Button>
      {result ? (
        <div
          className={
            result.status === "current"
              ? "flex items-start gap-2 rounded-md border p-3 text-sm"
              : "border-destructive/40 flex items-start gap-2 rounded-md border p-3 text-sm"
          }
        >
          {result.status === "current" ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          ) : (
            <TriangleAlert className="text-destructive mt-0.5 size-4 shrink-0" />
          )}
          <span>{result.message}</span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Printed Avery sheet history: every label sheet generated on this browser,
 * with the FarmOps version it came from. Each printed cell also carries the same
 * version code, so a sheet on a panel door can be traced back to this list.
 */
function LabelVersionHistory({
  entries,
  onClear,
}: {
  entries: DocVersionHistoryEntry[];
  onClear: () => void;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="size-4" />
          Avery label sheet version history
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!entries.length}
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([historyCsv(entries)], { type: "text/csv" }),
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = "avery-label-version-history.csv";
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <FileDown className="mr-2 size-4" />
            Export CSV
          </Button>
          <Button variant="ghost" size="sm" disabled={!entries.length} onClick={onClear}>
            Clear
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No label sheets printed from this browser yet. Each generated sheet is recorded here with
            its version code, the snapshot it was built from and whether it came from the live
            snapshot or a captured bundle.
          </p>
        ) : (
          <ul className="divide-border divide-y text-sm">
            {entries.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
                <span className="font-mono text-xs">{e.versionCode}</span>
                <Badge variant="outline" className="text-[10px]">
                  {e.sourceKind === "live" ? "live snapshot" : `captured ${e.sourceLabel}`}
                </Badge>
                <span className="text-muted-foreground text-xs">
                  data {e.generatedAt} · schema {e.schemaVersion} · API {e.apiVersion}
                </span>
                <span className="text-muted-foreground text-xs">
                  {e.counts["labels"] ?? 0} labels · {e.scope}
                </span>
                <span className="text-muted-foreground text-xs">
                  printed {new Date(e.printedAt).toLocaleString()} by {e.printedBy}
                </span>
                <span className="text-muted-foreground w-full text-xs break-all">{e.fileName}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
