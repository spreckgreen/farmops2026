// Read-only panel sheet — the destination of a scanned panel QR label.
// Everything on this page is a view of the current record. Corrections are only
// possible inside an administrator-approved 24-hour window.
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, Network, Printer, QrCode, Save } from "lucide-react";

import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { CollapsibleSection } from "@/components/electrical/collapsible-section";
import {
  PanelAccessRequest,
  SystemDataAccessRequest,
} from "@/components/electrical/panel-access-request";
import { PanelLocalTopology } from "@/components/electrical/panel-local-topology";
import { PanelQrLabel } from "@/components/electrical/panel-qr-label";
import { useAddon } from "@/hooks/use-addon";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import {
  ensurePanelScanAccess,
  panelSheet,
  savePanelSheetDetails,
  PANEL_SHEET_EDITABLE,
  type PanelRow,
} from "@/lib/panel-access.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/electrical/panel/$panelId")({
  // The Supabase session lives in browser storage, so the auth check must run
  // client-side only — an SSR gate never sees the session and bounces the
  // scanned label back to /auth forever.
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  component: PanelSheetPage,
  head: ({ params }) => ({
    meta: [
      { title: `Panel ${params.panelId} — Bostead Farms Electrical` },
      {
        name: "description",
        content: `Current field record for electrical panel ${params.panelId}: breakers, feeders, raceways, circuits and loads.`,
      },
      { property: "og:title", content: `Panel ${params.panelId} — Bostead Farms Electrical` },
      {
        property: "og:description",
        content: "Read-only panel sheet reached by scanning the printed panel label.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

const cell = (row: PanelRow, key: string) => {
  const v = row[key];
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
};

function DataTable({ rows, columns }: { rows: PanelRow[]; columns: [string, string][] }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">No records.</p>;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map(([key, label]) => (
              <TableHead key={key}>{label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={String(row["id"])}>
              {columns.map(([key]) => (
                <TableCell key={key} className="whitespace-nowrap text-xs">
                  {cell(row, key)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

const NUMERIC_FIELDS = new Set(["bus_rating_amps", "voltage", "spaces", "circuits"]);

function PanelSheetPage() {
  const { panelId } = Route.useParams();
  const queryClient = useQueryClient();
  const ensureAccess = useServerFn(ensurePanelScanAccess);
  const fetchSheet = useServerFn(panelSheet);
  const saveDetails = useServerFn(savePanelSheetDetails);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);

  // A viewer who just signed up after scanning the label holds no Electrical
  // entitlement yet. This self-provisions the scan-scoped add-on for the panel
  // on the label before the sheet is read, so the QR code is never a dead end.
  const access = useQuery({
    queryKey: ["panel-scan-access", panelId],
    queryFn: async () => {
      const res = await ensureAccess({ data: { panelId } });
      if (res.granted) await queryClient.invalidateQueries({ queryKey: ["my-addons"] });
      return res;
    },
    retry: false,
    staleTime: 5 * 60_000,
  });

  const sheet = useQuery({
    queryKey: ["panel-sheet", panelId],
    queryFn: () => fetchSheet({ data: { panelId } }),
    enabled: access.isSuccess,
  });

  const origin = typeof window === "undefined" ? "" : window.location.origin;

  const save = useMutation({
    mutationFn: () => saveDetails({ data: { panelId, values: draft ?? {} } }),
    onSuccess: () => {
      toast.success("Panel details saved.");
      setDraft(null);
      void sheet.refetch();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not save the panel details."),
  });

  const panel = sheet.data?.panel;
  // A scanned label is scoped: this panel plus its own local topology. Anything
  // wider (other panels, the farm-wide topology, the module sub-navigation)
  // stays hidden until an administrator approves a system-data window — unless
  // the user already holds the full Electrical add-on, which is system-wide.
  const fullAddon = useAddon("electrical");
  const readOnlyAddon = useAddon("electrical_readonly");
  const fullAccess =
    fullAddon.enabled ||
    readOnlyAddon.enabled ||
    (sheet.data?.system_access.granted ?? false);

  const startEditing = () => {
    if (!panel) return;
    const next: Record<string, string> = {};
    for (const field of PANEL_SHEET_EDITABLE) next[field] = String(panel[field] ?? "");
    setDraft(next);
  };

  const summary = useMemo(() => {
    if (!sheet.data) return [];
    return [
      ["Breakers recorded", sheet.data.breakers.length],
      ["Circuit groups", sheet.data.circuit_groups.length],
      ["Loads", sheet.data.loads.length],
      ["Feeders in", sheet.data.feeders_in.length],
      ["Feeders out", sheet.data.feeders_out.length],
      ["Raceways leaving", sheet.data.raceways.length],
      ["Branch runs", sheet.data.branch_runs.length],
    ] as [string, number][];
  }, [sheet.data]);

  return (
    <ElectricalGate hideNav={!fullAccess} allowScanScope>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
          {fullAccess ? (
            <Button asChild variant="ghost" size="sm">
              <Link to="/electrical/labels">
                <ArrowLeft className="mr-1 h-4 w-4" /> Panel labels
              </Link>
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">
              Scanned label view — {panelId} only
            </span>
          )}
          <div className="flex flex-wrap gap-2">
            {fullAccess ? (
              <Button asChild variant="outline" size="sm">
                <Link to="/electrical/topology">
                  <Network className="mr-1 h-4 w-4" /> Full system topology
                </Link>
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="mr-1 h-4 w-4" /> Print sheet
            </Button>
          </div>
        </div>

        {access.isLoading || (sheet.isLoading && !sheet.error) ? (
          <Skeleton className="h-64 w-full" />
        ) : access.error || sheet.error ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Couldn't load panel {panelId}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {(access.error ?? sheet.error) instanceof Error
                ? (access.error ?? sheet.error as Error).message
                : "Unknown error."}
            </CardContent>
          </Card>

        ) : sheet.data && panel ? (
          <>
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="font-mono text-2xl">{panelId}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {String(panel["description"] ?? "No description recorded")}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <PanelAccessRequest
                    panelId={panelId}
                    access={sheet.data.access}
                    onChanged={() => void sheet.refetch()}
                  />
                  {fullAccess ? null : (
                    <SystemDataAccessRequest
                      panelId={panelId}
                      access={sheet.data.system_access}
                      building={(panel["building"] as string | null) ?? null}
                      site={(panel["site"] as string | null) ?? null}
                      onChanged={() => void sheet.refetch()}
                    />
                  )}

                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    ["Building", panel["building"]],
                    ["Grid", panel["grid"]],
                    ["Fed from", panel["feeder_source"]],
                    ["Bus rating", panel["bus_rating_amps"] ? `${panel["bus_rating_amps"]} A` : null],
                    [
                      "System voltage",
                      sheet.data.voltage_designation ??
                        (panel["voltage"] ? `${panel["voltage"]} V (scalar)` : null),
                    ],
                    ["Phase", panel["phase"]],
                    ["Spaces", panel["spaces"]],
                    ["Backup class", panel["backup_class"]],
                    ["Install status", panel["install_status"]],
                    ["Label status", panel["label_status"]],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-md border border-border p-2">
                      <dt className="text-xs text-muted-foreground">{String(label)}</dt>
                      <dd className="text-sm font-medium">
                        {value === null || value === undefined || value === "" ? "—" : String(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
                {panel["notes"] ? (
                  <p className="rounded-md bg-muted/60 p-2 text-sm">{String(panel["notes"])}</p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {summary.map(([label, count]) => (
                    <Badge key={label} variant="outline">
                      {label}: {count}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>

            {sheet.data.access.can_edit ? (
              <Card className="print:hidden">
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <CardTitle className="text-base">Correct panel details</CardTitle>
                  {draft ? null : (
                    <Button size="sm" variant="outline" onClick={startEditing}>
                      Edit details
                    </Button>
                  )}
                </CardHeader>
                {draft ? (
                  <CardContent className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {PANEL_SHEET_EDITABLE.map((field) => (
                        <div key={field} className="space-y-1">
                          <Label htmlFor={`panel-${field}`} className="text-xs">
                            {field.replace(/_/g, " ")}
                          </Label>
                          <Input
                            id={`panel-${field}`}
                            inputMode={NUMERIC_FIELDS.has(field) ? "numeric" : undefined}
                            value={draft[field] ?? ""}
                            onChange={(e) =>
                              setDraft({ ...draft, [field]: e.target.value })
                            }
                          />
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      The stable panel ID {panelId} can never be changed here.
                    </p>
                    <div className="flex gap-2">
                      <Button onClick={() => save.mutate()} disabled={save.isPending}>
                        <Save className="mr-1 h-4 w-4" />
                        {save.isPending ? "Saving…" : "Save corrections"}
                      </Button>
                      <Button variant="ghost" onClick={() => setDraft(null)}>
                        Cancel
                      </Button>
                    </div>
                  </CardContent>
                ) : null}
              </Card>
            ) : null}

            <CollapsibleSection
              title="Local topology for this panel"
              subtitle="This panel's own feeders, circuits, loads and raceway endpoints"
            >
              <PanelLocalTopology
                panelId={panelId}
                description={panel["description"] as string | null}
                busRatingAmps={panel["bus_rating_amps"] as number | null}
                voltageText={
                  sheet.data.voltage_designation ??
                  (panel["voltage"] ? `${panel["voltage"]} V` : null)
                }
                feedersIn={sheet.data.feeders_in}
                feedersOut={sheet.data.feeders_out}
                raceways={sheet.data.raceways}
                circuitGroups={sheet.data.circuit_groups}
                loads={sheet.data.loads}
                branchRuns={sheet.data.branch_runs}
              />
            </CollapsibleSection>

            <CollapsibleSection
              title="Breaker positions"
              subtitle={`${sheet.data.breakers.length} recorded`}
            >
              <DataTable
                rows={sheet.data.breakers.map((b) => {
                  const group = sheet.data!.circuit_groups.find(
                    (g) => g["id"] === b["circuit_group_uuid"],
                  );
                  return {
                    ...b,
                    // Derived display only; identity stays panel + position.
                    breaker_relationship:
                      breakerRelationshipLabel({
                        panel_id: panelId,
                        breaker_number: b["breaker_number"] as number | null,
                        circuit_group_id: group
                          ? String(group["circuit_group_id"] ?? "")
                          : null,
                        description:
                          group?.["description"] == null ? null : String(group["description"]),
                      }) ?? null,
                  };
                })}
                columns={[
                  ["breaker_number", "Breaker"],
                  ["breaker_relationship", "Relationship"],
                  ["side", "Side"],
                  ["position", "Pos"],
                  ["poles", "Poles"],
                  ["ocp_amps", "OCP (A)"],
                  ["label", "Label"],
                  ["install_status", "Status"],
                  ["notes", "Notes"],
                ]}
              />
            </CollapsibleSection>

            <CollapsibleSection title="Circuit groups" subtitle={`${sheet.data.circuit_groups.length}`}>
              <DataTable
                rows={sheet.data.circuit_groups.map((g) => ({
                  ...g,
                  breaker_relationship:
                    breakerRelationshipLabel({
                      panel_id: panelId,
                      breaker_number: g["breaker_number"] as number | null,
                      circuit_group_id: String(g["circuit_group_id"] ?? ""),
                      description: g["description"] == null ? null : String(g["description"]),
                    }) ?? null,
                }))}
                columns={[
                  ["circuit_group_id", "Circuit"],
                  ["breaker_relationship", "Relationship"],
                  ["description", "Description"],
                  ["breaker_number", "Breaker"],
                  ["circuit_rating_amps", "Rating (A)"],
                  ["voltage", "V"],
                  ["phase", "Phase"],
                  ["install_status", "Status"],
                ]}
              />
            </CollapsibleSection>

            <CollapsibleSection title="Loads on this panel" subtitle={`${sheet.data.loads.length}`}>
              <DataTable
                rows={sheet.data.loads}
                columns={[
                  ["load_id", "Load"],
                  ["description", "Description"],
                  ["area", "Area"],
                  ["amps", "A"],
                  ["volts", "V"],
                  ["circuit_group_ref", "Circuit"],
                  ["install_status", "Status"],
                ]}
              />
            </CollapsibleSection>

            <CollapsibleSection
              title="Feeders"
              subtitle={`${sheet.data.feeders_in.length} in · ${sheet.data.feeders_out.length} out`}
            >
              <div className="space-y-4">
                <div>
                  <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                    Feeding this panel
                  </p>
                  <DataTable
                    rows={sheet.data.feeders_in}
                    columns={[
                      ["feeder_id", "Feeder"],
                      ["source_endpoint_ref", "From"],
                      ["conductor_size", "Conductor"],
                      ["ampacity_amps", "Ampacity"],
                      ["ocp_rating_amps", "OCP"],
                      ["install_status", "Status"],
                    ]}
                  />
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                    Fed from this panel
                  </p>
                  <DataTable
                    rows={sheet.data.feeders_out}
                    columns={[
                      ["feeder_id", "Feeder"],
                      ["dest_endpoint_ref", "To"],
                      ["conductor_size", "Conductor"],
                      ["ampacity_amps", "Ampacity"],
                      ["ocp_rating_amps", "OCP"],
                      ["install_status", "Status"],
                    ]}
                  />
                </div>
              </div>
            </CollapsibleSection>

            <CollapsibleSection title="Raceways leaving the panel" subtitle={`${sheet.data.raceways.length}`}>
              <DataTable
                rows={sheet.data.raceways}
                columns={[
                  ["conduit_id", "Raceway"],
                  ["exit_side", "Exit side"],
                  ["exit_order", "Order"],
                  ["trade_size", "Size"],
                  ["dest_endpoint_ref", "To"],
                  ["install_status", "Status"],
                ]}
              />
            </CollapsibleSection>

            <CollapsibleSection title="Branch runs from the panel" subtitle={`${sheet.data.branch_runs.length}`}>
              <DataTable
                rows={sheet.data.branch_runs}
                columns={[
                  ["branch_id", "Branch"],
                  ["dest_endpoint_ref", "To"],
                  ["conductor_size", "Conductor"],
                  ["circuit_rating_amps", "Rating (A)"],
                  ["wiring_method", "Method"],
                  ["install_status", "Status"],
                ]}
              />
            </CollapsibleSection>

            <CollapsibleSection title="Printed label for this panel" defaultOpen={false}>
              <div className="space-y-3">
                <PanelQrLabel
                  panel={{
                    panel_id: panelId,
                    description: panel["description"] as string | null,
                    building: panel["building"] as string | null,
                    grid: panel["grid"] as string | null,
                    bus_rating_amps: panel["bus_rating_amps"] as number | null,
                    voltage: panel["voltage"] as number | null,
                    phase: panel["phase"] as string | null,
                    spaces: panel["spaces"] as number | null,
                    feeder_source: panel["feeder_source"] as string | null,
                    voltage_designation: sheet.data.voltage_designation,
                  }}
                  origin={origin}
                  format="label-7676"
                />
                <p className="text-xs text-muted-foreground">
                  <QrCode className="mr-1 inline h-3.5 w-3.5" />
                  Print this from the labels page to get the full sheet of panels at once.
                </p>
              </div>
            </CollapsibleSection>

            <p className="text-xs text-muted-foreground">
              Snapshot read {new Date(sheet.data.captured_at).toLocaleString()}. Read-only unless an
              administrator has approved a temporary edit window.
              {fullAccess
                ? ""
                : " This scan is scoped to this panel and its local topology — use the request button above if you need other panels or the full system data."}
            </p>
          </>
        ) : null}
      </div>
    </ElectricalGate>
  );
}
