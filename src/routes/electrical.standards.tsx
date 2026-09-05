import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { naming_standards } from "@/lib/electrical.functions";
import {
  mergeStandards,
  INFRASTRUCTURE_ID_REFERENCE,
  STABLE_ID_REFERENCE,
} from "@/lib/electrical-standards";
import { INFRASTRUCTURE_ID_STANDARDS } from "@/lib/electrical-infrastructure-standards";
import {
  BREAKER_REFERENCE_EXAMPLE,
  BREAKER_REFERENCE_SHAPE,
  CIRCUIT_GROUP_ID_EXAMPLE,
  CIRCUIT_GROUP_ID_SHAPE,
  breakerRelationshipLabel,
} from "@/lib/electrical-breaker-reference";


import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/electrical/standards")({
  component: StandardsPage,
  head: () => ({
    meta: [
      { title: "Electrical Naming Standards — Bostead Farms" },
      {
        name: "description",
        content:
          "Stable ID formats, panel exit conventions and field walk order rules for the electrical infrastructure record.",
      },
      { property: "og:title", content: "Electrical Naming Standards — Bostead Farms" },
      {
        property: "og:description",
        content: "Stable ID formats and field conventions for electrical records.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function StandardsPage() {
  return (
    <ElectricalGate>
      <Standards />
    </ElectricalGate>
  );
}

function Standards() {
  const fetcher = useServerFn(naming_standards);
  const q = useQuery({ queryKey: ["electrical", "standards"], queryFn: () => fetcher() });
  const rows = mergeStandards((q.data ?? []) as unknown as Record<string, unknown>[]);
  const storedKeys = new Set(
    ((q.data ?? []) as unknown as Record<string, unknown>[]).map((r) => String(r["key"] ?? "")),
  );

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Conventions that must not drift</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2 text-muted-foreground">
          <p>
            Stable IDs are permanent and carry no physical attributes — a raceway keeps{" "}
            <span className="font-mono">CON-105</span> even if its size, type, route or status
            changes. Every raceway uses <span className="font-mono">CON-###</span> regardless of
            construction; EMT, FLEX/FMC/LFMC, PVC and underground conduit are recorded in the
            Raceway type field, never in the ID.
          </p>
          <p>
            Raceway, junction box and branch run IDs are hierarchical:{" "}
            <span className="font-mono">CON-104</span> →{" "}
            <span className="font-mono">JB-104-02</span> →{" "}
            <span className="font-mono">BR-104-02-03</span>, so a technician can read the
            originating raceway and junction box straight from the ID. A branch run always inherits
            the junction box it physically originates from, and branch-run numbering restarts at{" "}
            <span className="font-mono">01</span> for each box.
          </p>

          <p>
            Panel raceway exits are numbered from the lower-right corner and proceed
            counterclockwise while facing the panel.
          </p>
          <p>
            The Farm Shop installation walk starts at <span className="font-mono">A6</span>{" "}
            (NE corner) and proceeds clockwise, outside-in.
          </p>
          <p>
            Interior and site raceways live in one dataset and are separated by the
            environment field, not by duplicate records.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Reference table — stable ID formats</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0 sm:p-6 sm:pt-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Entity</th>
                <th className="px-3 py-2 font-medium">Format</th>
                <th className="px-3 py-2 font-medium">Example</th>
                <th className="px-3 py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {[...STABLE_ID_REFERENCE, ...INFRASTRUCTURE_ID_REFERENCE].map((row) => (
                <tr key={row.entity} className="border-t border-border align-top">
                  <td className="px-3 py-2 whitespace-nowrap">{row.entity}</td>
                  <td className="px-3 py-2 font-mono whitespace-nowrap">{row.format}</td>
                  <td className="px-3 py-2 font-mono whitespace-nowrap">{row.example}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Breaker reference and circuit group relationship
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            <span className="font-mono">{BREAKER_REFERENCE_SHAPE}</span> — e.g.{" "}
            <span className="font-mono">{BREAKER_REFERENCE_EXAMPLE}</span> — is derived and
            read-only. The authoritative breaker-position identity remains the panel UUID plus the
            physical position.
          </p>
          <p>
            Circuit groups keep independent permanent IDs{" "}
            <span className="font-mono">{CIRCUIT_GROUP_ID_SHAPE}</span> (e.g.{" "}
            <span className="font-mono">{CIRCUIT_GROUP_ID_EXAMPLE}</span>).
          </p>
          <p>
            Relationships display as{" "}
            <span className="font-mono">
              {breakerRelationshipLabel({
                panel_id: "PNL-FS-NW",
                breaker_number: 39,
                circuit_group_id: CIRCUIT_GROUP_ID_EXAMPLE,
                description: "Shop east receptacles",
              })}
            </span>{" "}
            and are stored only as the breaker position&rsquo;s circuit group link.
          </p>
          <p>
            A breaker reference is never concatenated into a circuit group ID, and a circuit group is
            never renamed when its breaker assignment changes.
          </p>
        </CardContent>
      </Card>


      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Infrastructure ID tokens — racks, power assets and devices
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {(["rack", "power_asset", "device"] as const).map((kind) => {
            const std = INFRASTRUCTURE_ID_STANDARDS[kind];
            return (
              <div key={kind} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{std.label}</span>
                  <Badge variant="outline" className="text-xs">
                    {std.assignment === "user-assigned" ? "User-assigned" : "System-generated"}
                  </Badge>
                </div>
                {std.formats.map((format) => (
                  <div key={format.shape} className="rounded-md border border-border p-3">
                    <p className="font-mono text-sm">{format.shape}</p>
                    <p className="text-xs text-muted-foreground">
                      Examples: <span className="font-mono">{format.examples.join(", ")}</span>
                    </p>
                    <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                      {format.tokens.map((t) => (
                        <li key={t.token}>
                          <span className="font-mono">{t.token}</span> — {t.meaning}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">{std.assignmentNote}</p>
                <p className="text-xs text-muted-foreground">{std.stabilityNote}</p>
                {std.legacyFormats?.length ? (
                  <p className="text-xs text-muted-foreground">
                    Pre-standard shapes still accepted on existing records (never renamed, never
                    created):{" "}
                    <span className="font-mono">
                      {std.legacyFormats.map((f) => f.shape).join(", ")}
                    </span>
                  </p>
                ) : null}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Naming and design standards</CardTitle>
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <div className="space-y-3">
              {q.error ? (
                <p className="text-sm text-destructive">
                  Stored standards could not be loaded ({(q.error as Error).message}). Showing
                  the built-in conventions.
                </p>
              ) : null}
              {rows.map((row) => (
                <div key={row.key} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{row.title}</span>
                    <Badge variant="secondary" className="font-mono text-xs">
                      {row.key}
                    </Badge>
                    {storedKeys.has(row.key) ? null : (
                      <Badge variant="outline" className="text-xs">
                        Built-in
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground whitespace-pre-line">
                    {row.body}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

