// Consolidated Farm Shop grid reconciliation workspace.
//
// Status and Field Verification are new; Canonical Comparison, Repair and
// History reuse the existing recovery, mapping-repair and migration panels
// unchanged so their classifications and counts stay exactly as accepted.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { CollapsibleGroup } from "@/components/electrical/collapsible-section";
import { AssetDetail } from "@/components/electrical/grid-operational-map";
import { GridRecoveryPanel } from "@/components/electrical/grid-recovery-panel";
import { GridMigrationPanel } from "@/components/electrical/grid-migration-panel";
import { MappingAuditPanel } from "@/components/electrical/mapping-audit-panel";
import { MappingRepairPanel } from "@/components/electrical/mapping-repair-panel";
import {
  electricalGridOperational,
  saveGridFieldVerification,
} from "@/lib/electrical-grid-operational.functions";
import {
  ASSET_KIND_LABEL,
  operationalCsv,
  OPERATIONAL_MODEL_VERSION,
  PRECISION_META,
  PRECISION_ORDER,
  QUEUE_LABEL,
  QUEUE_ORDER,
  queueGroupsFor,
  VERIFICATION_LABEL,
  VERIFICATION_STATUSES,
  verificationOf,
  type OperationalAsset,
  type VerificationStatus,
} from "@/lib/electrical-grid-operational";
import { GRID_MIGRATION_VERSION } from "@/lib/electrical-grid-migration";
import { IMPORT_CONTRACT_V3_VERSION } from "@/lib/electrical-load-contract-v3";

export type DataQualityTab =
  | "status"
  | "field-verification"
  | "canonical-comparison"
  | "repair"
  | "history";

export const DATA_QUALITY_TABS: DataQualityTab[] = [
  "status",
  "field-verification",
  "canonical-comparison",
  "repair",
  "history",
];

const TAB_LABEL: Record<DataQualityTab, string> = {
  status: "Status",
  "field-verification": "Field Verification",
  "canonical-comparison": "Canonical Comparison",
  repair: "Repair",
  history: "History",
};

function useOperational() {
  const fetcher = useServerFn(electricalGridOperational);
  return useQuery({ queryKey: ["electrical", "grid-operational"], queryFn: () => fetcher() });
}

export function GridDataQualityPanel({
  tab,
  onTabChange,
}: {
  tab: DataQualityTab;
  onTabChange: (t: DataQualityTab) => void;
}) {
  return (
    <Tabs value={tab} onValueChange={(v) => onTabChange(v as DataQualityTab)}>
      <TabsList className="flex-wrap">
        {DATA_QUALITY_TABS.map((t) => (
          <TabsTrigger key={t} value={t}>
            {TAB_LABEL[t]}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="status" className="mt-3">
        <StatusTab />
      </TabsContent>
      <TabsContent value="field-verification" className="mt-3">
        <FieldVerificationTab />
      </TabsContent>
      <TabsContent value="canonical-comparison" className="mt-3 space-y-3">
        <p className="text-sm text-muted-foreground">
          Read-only comparison against the SHA-authorized canonical workbook. The canonical
          engineering release stays authoritative for design values; FarmOps stays authoritative for
          approved field / as-built observations.
        </p>
        <GridRecoveryPanel />
      </TabsContent>
      <TabsContent value="repair" className="mt-3 space-y-3">
        <p className="text-sm text-muted-foreground">
          Repair is per-record: each correction needs a reason and evidence, the previous value is
          written to immutable audit history, and the audit is re-run afterwards. The canonical
          workbook is never written.
        </p>
        <CollapsibleGroup title="Mapping audit results (open a record to repair it)">
          <MappingAuditPanel />
        </CollapsibleGroup>
        <MappingRepairPanel />
      </TabsContent>
      <TabsContent value="history" className="mt-3 space-y-3">
        <p className="text-sm text-muted-foreground">
          Grid migration is complete. This history view is read-only: mapping dictionaries, source
          and binding versions, record counts, warnings and exported audit evidence are preserved.
        </p>
        <GridMigrationPanel readOnly />
      </TabsContent>
    </Tabs>
  );
}

/* ------------------------------------------------------------------- status */

function StatusTab() {
  const q = useOperational();
  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.error) return <p className="text-sm text-destructive">{(q.error as Error).message}</p>;
  const data = q.data!;
  const p = data.summary.precision;
  const disagreements = data.assets.filter(
    (a) =>
      (a.designGrid ?? "").trim() &&
      (a.grid ?? "").trim() &&
      (a.designGrid ?? "").trim().toUpperCase() !== (a.grid ?? "").trim().toUpperCase(),
  ).length;
  const lastUpdated = data.assets
    .map((a) => a.updatedAt)
    .filter(Boolean)
    .sort()
    .pop();

  const counted =
    p.EXACT + p.NEAREST + p.INTERVAL + p.GRIDLINE + p.NON_FIXED + p.UNRESOLVED;

  const cells: [string, string | number][] = [
    ["Total Farm Shop records", data.summary.total],
    ["Exact intersection", p.EXACT],
    ["Nearest gridline", p.NEAREST],
    ["Gridline only", p.GRIDLINE],
    ["Interval preserved", p.INTERVAL],
    ["Unresolved", p.UNRESOLVED],
    ["Mobile / non-fixed", p.NON_FIXED],
    ["FarmOps vs design disagreement", disagreements],
    ["Last record update", lastUpdated ?? "not recorded"],
    ["Canonical source / binding", IMPORT_CONTRACT_V3_VERSION],
    ["Location model", OPERATIONAL_MODEL_VERSION],
    ["Migration status", `Complete (read-only history) — ${GRID_MIGRATION_VERSION}`],
  ];

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Farm Shop grid status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {cells.map(([k, v]) => (
              <div key={k} className="rounded-md border border-border p-2">
                <p className="text-xs text-muted-foreground">{k}</p>
                <p className="text-sm font-semibold">{v}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Classification counts reconcile to the record total ({counted} of{" "}
            {data.summary.total}). Nearest-gridline, interval-preserved and mobile classifications
            are valid states, not data errors.
          </p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(data.summary.kinds).map(([kind, n]) => (
              <Badge key={kind} variant="outline" className="text-[11px]">
                {ASSET_KIND_LABEL[kind as keyof typeof ASSET_KIND_LABEL] ?? kind}: {n}
              </Badge>
            ))}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const blob = new Blob([operationalCsv(data.assets)], { type: "text/csv" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "farm-shop-install-locations.csv";
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Export install-location CSV
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Verification state</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {VERIFICATION_STATUSES.map((v) => (
            <Badge key={v} variant="secondary" className="text-[11px]">
              {VERIFICATION_LABEL[v]}: {data.summary.verification[v]}
            </Badge>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------- field verification */

function FieldVerificationTab() {
  const q = useOperational();
  const [open, setOpen] = useState<string | null>(null);

  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.error) return <p className="text-sm text-destructive">{(q.error as Error).message}</p>;
  const assets = q.data!.assets;

  const groups = QUEUE_ORDER.map((g) => ({
    group: g,
    rows: assets.filter((a) => queueGroupsFor(a).includes(g)),
  }));

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Walkaround queue for final install locations. Confirming a location writes only FarmOps
        as-built fields; the design / proposed location is preserved separately.
      </p>
      {groups.map(({ group, rows }) => (
        <CollapsibleGroup
          key={group}
          title={`${QUEUE_LABEL[group]} (${rows.length})`}
          defaultOpen={rows.length > 0 && group === "UNRESOLVED"}
        >
          {rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing in this group.</p>
          ) : (
            rows.map((a) => (
              <div key={`${a.kind}-${a.stableId}`} className="rounded-md border border-border p-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono font-medium">{a.stableId}</span>
                  <span className="text-muted-foreground">{a.description ?? "—"}</span>
                  <Badge variant="outline" className="text-[11px]">
                    {PRECISION_META[a.precision].label}
                  </Badge>
                  <Badge variant="secondary" className="text-[11px]">
                    {VERIFICATION_LABEL[verificationOf(a.verification)]}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto h-7 px-2 text-xs"
                    onClick={() =>
                      setOpen((cur) => (cur === `${a.kind}-${a.stableId}` ? null : `${a.kind}-${a.stableId}`))
                    }
                  >
                    {open === `${a.kind}-${a.stableId}` ? "Close" : "Review"}
                  </Button>
                </div>
                {open === `${a.kind}-${a.stableId}` ? (
                  <div className="mt-2 space-y-2">
                    <AssetDetail asset={a} />
                    {a.kind === "load" || a.kind === "panel" ? (
                      <VerificationForm asset={a} onDone={() => setOpen(null)} />
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {ASSET_KIND_LABEL[a.kind]} records do not yet carry per-record verification
                        fields, so this entry is review-only.
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </CollapsibleGroup>
      ))}
    </div>
  );
}

function VerificationForm({
  asset,
  onDone,
}: {
  asset: OperationalAsset;
  onDone: () => void;
}) {
  const save = useServerFn(saveGridFieldVerification);
  const qc = useQueryClient();
  const [status, setStatus] = useState<VerificationStatus>(verificationOf(asset.verification));
  const [grid, setGrid] = useState(asset.grid ?? "");
  const [x, setX] = useState(asset.plottedXFt != null ? String(asset.plottedXFt) : "");
  const [y, setY] = useState(asset.plottedYFt != null ? String(asset.plottedYFt) : "");
  const [precision, setPrecision] = useState(asset.precision);
  const [evidence, setEvidence] = useState("");
  const [notes, setNotes] = useState(asset.verificationNotes ?? "");

  const locationDisabled = status === "INTENTIONALLY_MOBILE" || status === "NOT_YET_INSTALLED";

  const mutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          kind: asset.kind as "load" | "panel",
          stable_id: asset.stableId,
          field_verification_status: status,
          as_built_grid: locationDisabled ? undefined : grid.trim() || undefined,
          as_built_x_ft: locationDisabled || x.trim() === "" ? undefined : Number(x),
          as_built_y_ft: locationDisabled || y.trim() === "" ? undefined : Number(y),
          precision: locationDisabled ? undefined : precision,
          location_evidence: evidence.trim(),
          verification_notes: notes.trim() || undefined,
        },
      }),
    onSuccess: async () => {
      toast.success(`${asset.stableId} verification recorded`);
      await qc.invalidateQueries({ queryKey: ["electrical", "grid-operational"] });
      onDone();
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const usable = useMemo(() => evidence.trim().length >= 4, [evidence]);

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/40 p-2 text-xs">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="font-medium">Verification state</span>
          <select
            className="w-full rounded border border-border bg-background px-2 py-1"
            value={status}
            onChange={(e) => setStatus(e.target.value as VerificationStatus)}
          >
            {VERIFICATION_STATUSES.map((v) => (
              <option key={v} value={v}>
                {VERIFICATION_LABEL[v]}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="font-medium">Location precision</span>
          <select
            className="w-full rounded border border-border bg-background px-2 py-1"
            value={precision}
            disabled={locationDisabled}
            onChange={(e) => setPrecision(e.target.value as OperationalAsset["precision"])}
          >
            {PRECISION_ORDER.map((p) => (
              <option key={p} value={p}>
                {PRECISION_META[p].label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="font-medium">As-built grid</span>
          <Input
            value={grid}
            disabled={locationDisabled}
            onChange={(e) => setGrid(e.target.value)}
            placeholder="e.g. C3 or C-D2-3"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="font-medium">X (ft E)</span>
            <Input value={x} disabled={locationDisabled} onChange={(e) => setX(e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="font-medium">Y (ft S)</span>
            <Input value={y} disabled={locationDisabled} onChange={(e) => setY(e.target.value)} />
          </label>
        </div>
      </div>
      <label className="block space-y-1">
        <span className="font-medium">Evidence / field observation (required)</span>
        <Input
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
          placeholder="What was observed, by whom, and where"
        />
      </label>
      <label className="block space-y-1">
        <span className="font-medium">Verification notes</span>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </label>
      <p className="text-[11px] text-muted-foreground">
        {locationDisabled
          ? "Mobile and not-yet-installed records keep no as-built coordinates; the design location stays untouched."
          : "The previous values and this evidence are written to immutable audit history."}
      </p>
      <Button
        size="sm"
        disabled={!usable || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? "Recording…" : "Record verification"}
      </Button>
    </div>
  );
}
