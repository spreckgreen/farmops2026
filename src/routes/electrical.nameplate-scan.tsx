// Administrator-only large-load nameplate scan.
//
// Scans existing loads for sizeable equipment, badges each one with its
// nameplate coverage, runs an AI specification search for the ones that are
// missing a plate, and records confirmed values against the equipment row.
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentProfile } from "@/hooks/use-current-profile";
import {
  LARGE_LOAD_AMPS,
  LARGE_LOAD_VA,
  NAMEPLATE_LOOKUP_NOTE,
  type NameplateCoverageItem,
  type NameplateCoverageStatus,
} from "@/lib/electrical-nameplate-coverage";
import {
  lookupNameplateSpecs,
  recordScannedNameplate,
  scanLargeLoadNameplates,
  type NameplateLookupResult,
} from "@/lib/electrical-nameplate-coverage.functions";
import { NAMEPLATE_WRITE_FIELDS } from "@/lib/electrical-nameplate-write";
import { Loader2, Search, ShieldCheck, Zap } from "lucide-react";

export const Route = createFileRoute("/electrical/nameplate-scan")({
  component: NameplateScanPage,
  head: () => ({
    meta: [
      { title: "Large-Load Nameplate Scan — Bostead Farms" },
      {
        name: "description",
        content:
          "Administrator scan of large electrical loads: which equipment rows carry a recorded nameplate, AI specification search for the rest, and an audited record path.",
      },
      { property: "og:title", content: "Large-Load Nameplate Scan — Bostead Farms" },
      {
        property: "og:description",
        content:
          "Nameplate coverage for large loads, with AI specification lookup and an audited administrator record path.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

const BADGE_VARIANT: Record<NameplateCoverageStatus, "default" | "secondary" | "outline"> = {
  recorded: "default",
  partial: "secondary",
  missing: "outline",
};

function NameplateScanPage() {
  const profile = useCurrentProfile();
  const isAdmin = profile.data?.isAdmin === true;

  return (
    <ElectricalGate>
      <div className="space-y-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            Large-load nameplate scan
          </h1>
          <p className="text-sm text-muted-foreground">
            Equipment at or above {LARGE_LOAD_VA} VA or {LARGE_LOAD_AMPS} A, plus dedicated
            circuits. Administrator only.
          </p>
        </div>

        {profile.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : !isAdmin ? (
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground">
              The large-load nameplate scan is limited to administrators. Field nameplate
              photos and draft submissions live in{" "}
              <Link to="/electrical/assistant" className="underline">
                AI assist
              </Link>
              .
            </CardContent>
          </Card>
        ) : (
          <ScanBody />
        )}
      </div>
    </ElectricalGate>
  );
}

function ScanBody() {
  const scan = useServerFn(scanLargeLoadNameplates);
  const { data, isLoading, error } = useQuery({
    queryKey: ["nameplate-coverage"],
    queryFn: () => scan(),
  });
  const [onlyGaps, setOnlyGaps] = useState(true);

  const items = useMemo(() => {
    const all = data?.items ?? [];
    return onlyGaps ? all.filter((i) => i.status !== "recorded") : all;
  }, [data?.items, onlyGaps]);

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive">
          {(error as Error).message}
        </CardContent>
      </Card>
    );
  }

  const s = data!.summary;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="text-base">Coverage</CardTitle>
          <p className="text-xs text-muted-foreground">{NAMEPLATE_LOOKUP_NOTE}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge variant="outline">{data!.scanned} loads scanned</Badge>
            <Badge variant="outline">{s.total} large loads</Badge>
            <Badge>{s.recorded} recorded</Badge>
            <Badge variant="secondary">{s.partial} partial</Badge>
            <Badge variant="outline">{s.missing} missing</Badge>
            <Badge variant="outline">{s.searchable} searchable by model</Badge>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={onlyGaps}
              onCheckedChange={(v) => setOnlyGaps(v === true)}
            />
            Show only equipment missing a complete nameplate
          </label>
        </CardContent>
      </Card>

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            No large loads match this filter.
          </CardContent>
        </Card>
      ) : (
        items.map((item) => <LoadRow key={item.id} item={item} />)
      )}
    </div>
  );
}

function LoadRow({ item }: { item: NameplateCoverageItem }) {
  const queryClient = useQueryClient();
  const lookup = useServerFn(lookupNameplateSpecs);
  const record = useServerFn(recordScannedNameplate);
  const [query, setQuery] = useState(item.searchHint ?? "");
  const [result, setResult] = useState<NameplateLookupResult | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [keep, setKeep] = useState<Record<string, boolean>>({});

  const search = useMutation({
    mutationFn: () => lookup({ data: { loadUuid: item.id, query: query.trim() } }),
    onSuccess: (res) => {
      setResult(res);
      const next: Record<string, string> = {};
      const chosen: Record<string, boolean> = {};
      for (const def of NAMEPLATE_WRITE_FIELDS) {
        const value = res.fields.find((f) => f.id === def.id)?.value ?? "";
        next[def.id] = value;
        chosen[def.id] = Boolean(value);
      }
      setValues(next);
      setKeep(chosen);
      toast[res.found ? "success" : "warning"](
        res.found
          ? `Draft ratings found for ${res.query}.`
          : `No attributable ratings for ${res.query} — record the plate from a photo instead.`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const save = useMutation({
    mutationFn: () =>
      record({
        data: {
          loadUuid: item.id,
          source: result ? "ai_spec_lookup" : "admin_entry",
          values: Object.fromEntries(
            NAMEPLATE_WRITE_FIELDS.filter((d) => keep[d.id] && values[d.id]?.trim()).map(
              (d) => [d.id, values[d.id]!.trim()],
            ),
          ),
        },
      }),
    onSuccess: (res) => {
      toast.success(
        `Recorded ${Object.keys(res.applied).length} nameplate field(s) on ${item.ref}.`,
      );
      setResult(null);
      void queryClient.invalidateQueries({ queryKey: ["nameplate-coverage"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">
            {item.ref} — {item.label}
          </CardTitle>
          <Badge variant={BADGE_VARIANT[item.status]}>{item.badge}</Badge>
          {item.source && (
            <Badge variant="outline" className="gap-1">
              <ShieldCheck className="h-3 w-3" />
              {item.source}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {[item.location, item.volts ? `${item.volts} V` : null, ...item.reasons]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {item.missing.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Missing: {item.missing.join(", ")}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[16rem] flex-1 space-y-1">
            <label className="text-xs text-muted-foreground">
              Manufacturer and model to search
            </label>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. Mitsubishi SUZ-KA18NAHZ"
            />
          </div>
          <Button
            variant="secondary"
            disabled={search.isPending || query.trim().length < 3}
            onClick={() => search.mutate()}
          >
            {search.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            AI nameplate search
          </Button>
          <Button asChild variant="ghost">
            <Link to="/electrical/item/$kind/$id" params={{ kind: "loads", id: item.id }}>
              Open load
            </Link>
          </Button>
        </div>

        {result && (
          <div className="space-y-2 rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">
              {result.engineLabel} · {result.model} · {result.backend} ·{" "}
              {result.latencyMs} ms
            </p>
            {result.notes && (
              <p className="text-xs text-muted-foreground">Model notes: {result.notes}</p>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              {NAMEPLATE_WRITE_FIELDS.map((def) => (
                <div key={def.id} className="flex items-center gap-2">
                  <Checkbox
                    checked={keep[def.id] === true}
                    onCheckedChange={(v) =>
                      setKeep((prev) => ({ ...prev, [def.id]: v === true }))
                    }
                  />
                  <span className="w-28 shrink-0 text-xs text-muted-foreground">
                    {def.label}
                  </span>
                  <Input
                    value={values[def.id] ?? ""}
                    onChange={(e) =>
                      setValues((prev) => ({ ...prev, [def.id]: e.target.value }))
                    }
                    placeholder="not found — type from the plate"
                  />
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Button disabled={save.isPending} onClick={() => save.mutate()}>
                {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Record nameplate
              </Button>
              <Button variant="ghost" onClick={() => setResult(null)}>
                Discard draft
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Confirm each value against the physical plate before recording. Recording is
              audited with your account and the source.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
