// Switches & controls: switch banks, the switching devices in them, control
// groups and the wiring segments between them. Read-only view over the records;
// power topology and control topology are shown separately and never merged.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { loadSwitchControlModel } from "@/lib/electrical-switch-controls.functions";
import {
  CONDUCTOR_FUNCTIONS,
  CONTROL_METHODS,
  SWITCH_LIFECYCLE_HELP,
  SWITCH_TYPES,
  bankComponentProgress,
  buildControlPathMermaid,
  buildPowerPathMermaid,
  deriveBankLifecycle,
  validateSwitchControlModel,
  type SwitchBankModel,
  type SwitchControlModel,
} from "@/lib/electrical-switch-controls";
import { AlertTriangle, Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/electrical/switch-controls")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Switches & Controls — Bostead Farms Electrical" },
      {
        name: "description",
        content:
          "Recorded switch banks, switching devices, control groups and wiring segments, with unverified facts shown as holds instead of guesses.",
      },
      { property: "og:title", content: "Switches & Controls — Bostead Farms Electrical" },
      {
        property: "og:description",
        content:
          "Switch banks, switching devices and control groups kept separate from power distribution records.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SwitchControlsPage,
});

const label = (map: Record<string, string> | undefined, uuid?: string | null) =>
  uuid ? (map?.[uuid] ?? "recorded link") : "not established";

function BankCard({
  bank,
  model,
  selected,
  onSelect,
}: {
  bank: SwitchBankModel;
  model: SwitchControlModel;
  selected: boolean;
  onSelect: () => void;
}) {
  const devices = model.devices.filter((d) => d.switch_bank_uuid === bank.uuid);
  const derived = deriveBankLifecycle({
    box: bank.box_state,
    raceway: bank.raceway_state,
    conductors: bank.conductors_state,
    devices: bank.devices_state,
    termination: bank.termination_state,
    functionTest: bank.function_test_state,
    installedDeviceCount: bank.installed_device_count ?? 0,
  });
  const progress = bankComponentProgress({
    box: bank.box_state,
    raceway: bank.raceway_state,
    conductors: bank.conductors_state,
    devices: bank.devices_state,
    termination: bank.termination_state,
    functionTest: bank.function_test_state,
  });

  return (
    <Card className={selected ? "border-primary" : undefined}>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <button type="button" className="font-mono underline-offset-2 hover:underline" onClick={onSelect}>
            {bank.stable_id}
          </button>
          <span className="text-sm font-normal text-foreground">
            {bank.description || "Switch bank"}
          </span>
          {bank.field_grid_reference && <Badge variant="outline">{bank.field_grid_reference}</Badge>}
          {bank.pole_ref && <Badge variant="outline">post {bank.pole_ref}</Badge>}
          <Badge variant="secondary">{derived.stage.replace(/_/g, " ")}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        <p className="text-muted-foreground">{SWITCH_LIFECYCLE_HELP[derived.stage]}</p>
        <div className="grid gap-1 sm:grid-cols-2">
          <p>
            Supplying circuit group:{" "}
            <span className="font-mono">
              {label(model.labels?.circuitGroups, bank.supplying_circuit_group_uuid)}
            </span>
          </p>
          <p>
            Fed from junction box:{" "}
            <span className="font-mono">
              {label(model.labels?.junctionBoxes, bank.source_jbox_uuid)}
            </span>
          </p>
          <p>
            Gangs: {bank.gang_count ?? "not recorded"} · devices installed:{" "}
            {bank.installed_device_count ?? 0}
          </p>
          <p>Enclosure: {bank.enclosure_type || "not recorded"}</p>
        </div>
        <div className="flex flex-wrap gap-1">
          {progress.map((row) => (
            <Badge key={row.key} variant={row.state === "installed" ? "default" : "outline"}>
              {row.label}: {row.state.replace(/_/g, " ")}
            </Badge>
          ))}
        </div>
        {devices.length === 0 ? (
          <p className="text-muted-foreground">
            No switching device is recorded in this enclosure. Device count and type stay open until
            observed.
          </p>
        ) : (
          <ul className="space-y-1">
            {devices.map((d) => (
              <li key={d.uuid} className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{d.stable_id}</span>
                <span>{d.switch_type?.replace(/_/g, " ") || "type not recorded"}</span>
                {d.gang_position != null && <Badge variant="outline">gang {d.gang_position}</Badge>}
                {d.design_only && <Badge variant="secondary">design only</Badge>}
                <span className="text-muted-foreground">
                  control group: {label(undefined, d.control_group_uuid) === "not established"
                    ? "not established"
                    : (model.groups.find((g) => g.uuid === d.control_group_uuid)?.stable_id ??
                      "recorded link")}
                </span>
              </li>
            ))}
          </ul>
        )}
        {bank.notes && <p className="text-muted-foreground">{bank.notes}</p>}
        {bank.evidence && <p className="text-muted-foreground">Evidence: {bank.evidence}</p>}
      </CardContent>
    </Card>
  );
}

function DiagramSource({ title, source }: { title: string; source: string }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void navigator.clipboard.writeText(source);
            toast.success("Diagram source copied");
          }}
        >
          <Copy className="mr-1 h-3 w-3" /> Copy
        </Button>
      </CardHeader>
      <CardContent>
        <pre className="overflow-x-auto rounded bg-muted p-3 text-[11px] leading-relaxed">
          {source}
        </pre>
      </CardContent>
    </Card>
  );
}

function SwitchControlsPage() {
  const fetchModel = useServerFn(loadSwitchControlModel);
  const q = useQuery({
    queryKey: ["electrical", "switch-controls"],
    queryFn: () => fetchModel({}),
  });
  const [selected, setSelected] = useState<string | null>(null);

  const model = q.data;
  const findings = useMemo(() => (model ? validateSwitchControlModel(model) : []), [model]);

  return (
    <ElectricalGate mode="read">
      <div className="space-y-4 p-4">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Switches &amp; controls</h1>
          <p className="text-sm text-muted-foreground">
            A switch bank is the FarmOps record for the device box holding switching devices; a
            control group is the FarmOps grouping of devices that operate the same target. Neither is
            an NEC-defined object, a switching device is never a load, and a control group is never a
            circuit group.
          </p>
        </header>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void q.refetch()}>
            <RefreshCw className="mr-1 h-3 w-3" /> Reload
          </Button>
          {model && (
            <span className="text-xs text-muted-foreground">
              {model.banks.length} switch banks · {model.devices.length} devices ·{" "}
              {model.groups.length} control groups · {model.segments.length} wiring segments
            </span>
          )}
        </div>

        {q.isLoading && <Skeleton className="h-40 w-full" />}
        {q.error && (
          <Card>
            <CardContent className="p-4 text-sm text-destructive">
              {(q.error as Error).message}
            </CardContent>
          </Card>
        )}

        {model && model.banks.length === 0 && (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              No switch bank is recorded yet. Observed enclosures are staged through a field audit
              batch, previewed field by field, and written only after approval.
            </CardContent>
          </Card>
        )}

        {model && (
          <div className="grid gap-3 lg:grid-cols-2">
            {model.banks.map((bank) => (
              <BankCard
                key={bank.uuid}
                bank={bank}
                model={model}
                selected={selected === bank.uuid}
                onSelect={() => setSelected(selected === bank.uuid ? null : bank.uuid)}
              />
            ))}
          </div>
        )}

        {model && model.groups.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Control groups</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {model.groups.map((g) => {
                const members = model.devices.filter((d) => d.control_group_uuid === g.uuid);
                const targets = model.targets.filter((t) => t.control_group_uuid === g.uuid);
                const method = CONTROL_METHODS.find((m) => m.value === g.control_method);
                return (
                  <div key={g.uuid} className="space-y-1 rounded border p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono">{g.stable_id}</span>
                      <span>{g.description || "Control group"}</span>
                      <Badge variant="outline">{method?.label ?? "method not recorded"}</Badge>
                      {g.design_only && <Badge variant="secondary">design only</Badge>}
                    </div>
                    <p className="text-muted-foreground">
                      {method?.plain ?? "The control arrangement has not been recorded."}
                    </p>
                    <p>
                      Member devices: {members.length}
                      {g.expected_device_count != null
                        ? ` of ${g.expected_device_count} expected`
                        : ""}{" "}
                      · targets:{" "}
                      {targets.length === 0
                        ? "not established"
                        : targets
                            .map(
                              (t) =>
                                (t.load_uuid && model.labels?.loads?.[t.load_uuid]) ||
                                t.target_ref ||
                                t.target_kind ||
                                "recorded target",
                            )
                            .join(", ")}
                    </p>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {model && model.segments.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Wiring segments</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {model.segments.map((seg) => {
                const fn = CONDUCTOR_FUNCTIONS.find((c) => c.value === seg.conductor_function);
                const from =
                  (seg.source_switch_bank_uuid &&
                    model.banks.find((b) => b.uuid === seg.source_switch_bank_uuid)?.stable_id) ||
                  label(model.labels?.junctionBoxes, seg.source_jbox_uuid);
                const to =
                  (seg.dest_switch_bank_uuid &&
                    model.banks.find((b) => b.uuid === seg.dest_switch_bank_uuid)?.stable_id) ||
                  label(model.labels?.loads, seg.dest_load_uuid);
                return (
                  <div key={seg.uuid} className="flex flex-wrap items-center gap-2 rounded border p-2">
                    <span className="font-mono">{seg.segment_id ?? "segment"}</span>
                    <span>
                      {from} → {to}
                    </span>
                    <Badge variant="outline">
                      {fn?.label ?? "conductor function unverified"}
                    </Badge>
                    {seg.observed_marking && (
                      <Badge variant="secondary">marking: {seg.observed_marking} (evidence only)</Badge>
                    )}
                  </div>
                );
              })}
              <p className="text-muted-foreground">
                A marking, tape or band is stored as evidence only. Conductor function is recorded
                after the conductor is traced or tested.
              </p>
            </CardContent>
          </Card>
        )}

        {findings.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4" /> Open questions and holds
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-xs">
              {findings.map((f, i) => (
                <p key={`${f.code}-${i}`}>
                  <Badge
                    variant={f.severity === "error" ? "destructive" : "outline"}
                    className="mr-2"
                  >
                    {f.severity}
                  </Badge>
                  <span className="font-mono">{f.stable_id}</span> — {f.message}
                </p>
              ))}
            </CardContent>
          </Card>
        )}

        {model && (
          <div className="grid gap-3 lg:grid-cols-2">
            <DiagramSource title="Power path" source={buildPowerPathMermaid(model)} />
            <DiagramSource title="Control path" source={buildControlPathMermaid(model)} />
          </div>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recognized switching-device types</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1 text-xs sm:grid-cols-2">
            {SWITCH_TYPES.map((t) => (
              <p key={t.value}>
                <span className="font-medium">{t.label}</span> — {t.plain}
              </p>
            ))}
          </CardContent>
        </Card>
      </div>
    </ElectricalGate>
  );
}
