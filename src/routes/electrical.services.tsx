// Utility services: permanent identity on the left, mutable configuration
// revisions on the right. The page deliberately never shows ampacity as part of
// a service's name — a 200 A House service that later becomes 400 A is the same
// SVC-HOUSE record with a newer commissioned revision.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ElectricalGate } from "@/components/electrical/electrical-gate";
import {
  commissionIntertieConfiguration,
  commissionServiceConfiguration,
  deleteServiceConfiguration,
  saveIntertie,
  saveIntertieConfiguration,
  saveService,
  saveServiceConfiguration,
  serviceState,
} from "@/lib/electrical-services.functions";
import {
  INTERTIE_LIFECYCLE_STATES,
  SERVICE_ID_SHAPE,
  SERVICE_LIFECYCLE_STATES,
  currentIntertieConfiguration,
  currentServiceConfiguration,
  futureServiceConfigurations,
  groupByParent,
  intertieLifecycleLabel,
  serviceLifecycleLabel,
  type Row,
} from "@/lib/electrical-services";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/electrical/services")({
  component: ServicesPage,
  head: () => ({
    meta: [
      { title: "Utility Services & Interties — Bostead Farms" },
      {
        name: "description",
        content:
          "Persistent utility service identities with dated, lifecycle-tagged configuration revisions for ampacity, service equipment, panel topology and intertie design.",
      },
      { property: "og:title", content: "Utility Services & Interties — Bostead Farms" },
      {
        property: "og:description",
        content: "Service identity stays fixed while ampacity, panels and intertie design evolve.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function ServicesPage() {
  return (
    <ElectricalGate>
      <Services />
    </ElectricalGate>
  );
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

function Services() {
  const qc = useQueryClient();
  const fetchState = useServerFn(serviceState);
  const q = useQuery({ queryKey: ["electrical", "services"], queryFn: () => fetchState() });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["electrical", "services"] });
  const mutate = useSaveFactory(invalidate);


  const addService = mutate(useServerFn(saveService), "Service saved");
  const addConfig = mutate(useServerFn(saveServiceConfiguration), "Configuration revision saved");
  const commission = mutate(
    useServerFn(commissionServiceConfiguration),
    "Revision commissioned as the current configuration",
  );
  const removeConfig = mutate(useServerFn(deleteServiceConfiguration), "Revision removed");
  const addTie = mutate(useServerFn(saveIntertie), "Intertie saved");
  const addTieConfig = mutate(useServerFn(saveIntertieConfiguration), "Intertie revision saved");
  const commissionTie = mutate(
    useServerFn(commissionIntertieConfiguration),
    "Intertie revision commissioned",
  );

  const data = q.data;
  const configsByService = useMemo(
    () => groupByParent((data?.configs ?? []) as Row[], "service_uuid"),
    [data],
  );
  const configsByTie = useMemo(
    () => groupByParent((data?.intertieConfigs ?? []) as Row[], "intertie_uuid"),
    [data],
  );

  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.error) return <p className="text-sm text-destructive">{(q.error as Error).message}</p>;

  const findings = data?.findings ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Identity vs. configuration</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            A service ID ({SERVICE_ID_SHAPE}, e.g. <span className="font-mono">SVC-HOUSE</span>) is a
            permanent logical identity. Ampacity, voltage, service equipment, meter arrangement,
            entry point and panel topology belong to dated configuration revisions — never to the ID.
            Upgrading the House service from 200 A to 400 A adds a revision; it never creates
            <span className="font-mono"> SVC-HOUSE-400A</span>.
          </p>
          <p>
            Planned and proposed revisions are stored alongside the as-built one and are not treated
            as energized. QA evaluates the current configuration only, until you explicitly
            commission a revision.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Current-state QA ({findings.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {findings.length === 0 ? (
            <p className="text-muted-foreground">No findings for the active configuration.</p>
          ) : (
            findings.map((f, i) => (
              <div key={i} className="flex items-start gap-2">
                <Badge
                  variant={
                    f.severity === "error"
                      ? "destructive"
                      : f.severity === "warning"
                        ? "secondary"
                        : "outline"
                  }
                >
                  {f.severity}
                </Badge>
                <span className="font-mono text-xs pt-0.5">{f.serviceId}</span>
                <span className="text-muted-foreground">{f.message}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <NewServiceForm onSubmit={(v) => addService.mutate(v)} pending={addService.isPending} />

      {((data?.services ?? []) as Row[]).map((svc) => {
        const configs = configsByService.get(str(svc["id"])) ?? [];
        const current = currentServiceConfiguration(configs);
        const future = futureServiceConfigurations(configs);
        return (
          <Card key={str(svc["id"])}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex flex-wrap items-center gap-2">
                <span className="font-mono">{str(svc["service_id"])}</span>
                <span className="text-muted-foreground font-normal">{str(svc["name"])}</span>
                {current ? (
                  <Badge variant="outline">
                    Current: {str(current["ampacity_amps"]) || "—"} A {str(current["voltage"])}{" "}
                    {str(current["phase"])}
                  </Badge>
                ) : (
                  <Badge variant="secondary">No current configuration</Badge>
                )}
                {future.length > 0 && <Badge variant="secondary">{future.length} future design(s)</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                {configs.length === 0 && (
                  <p className="text-sm text-muted-foreground">No configuration revisions yet.</p>
                )}
                {configs.map((c) => (
                  <div
                    key={str(c["id"])}
                    className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2 text-sm"
                  >
                    <Badge variant={c["is_current"] ? "default" : "outline"}>
                      {serviceLifecycleLabel(c["lifecycle_state"])}
                    </Badge>
                    <span>{str(c["revision_label"]) || "(unlabelled)"}</span>
                    <span className="text-muted-foreground">
                      {str(c["ampacity_amps"]) || "—"} A · {str(c["voltage"]) || "—"} ·{" "}
                      {str(c["phase"]) || "—"}
                    </span>
                    {str(c["service_equipment"]) && (
                      <span className="text-muted-foreground">{str(c["service_equipment"])}</span>
                    )}
                    <span className="ml-auto flex gap-2">
                      {!c["is_current"] && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={commission.isPending}
                          onClick={() => commission.mutate({ id: str(c["id"]), date: null })}
                        >
                          Commission as current
                        </Button>
                      )}
                      {!c["is_current"] && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={removeConfig.isPending}
                          onClick={() => removeConfig.mutate({ id: str(c["id"]) })}
                        >
                          Delete
                        </Button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
              <NewConfigForm
                serviceUuid={str(svc["id"])}
                pending={addConfig.isPending}
                onSubmit={(v) => addConfig.mutate(v)}
              />
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Service interties</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <NewIntertieForm pending={addTie.isPending} onSubmit={(v) => addTie.mutate(v)} />
          {((data?.interties ?? []) as Row[]).map((tie) => {
            const configs = configsByTie.get(str(tie["id"])) ?? [];
            const current = currentIntertieConfiguration(configs);
            return (
              <div key={str(tie["id"])} className="rounded-md border border-border p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono">{str(tie["intertie_id"])}</span>
                  <span className="text-muted-foreground">{str(tie["name"])}</span>
                  <Badge variant={current ? "default" : "secondary"}>
                    {current ? "Commissioned" : "Not energized"}
                  </Badge>
                </div>
                {configs.map((c) => (
                  <div key={str(c["id"])} className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant={c["is_current"] ? "default" : "outline"}>
                      {intertieLifecycleLabel(c["lifecycle_state"])}
                    </Badge>
                    <span>{str(c["revision_label"]) || "(unlabelled)"}</span>
                    <span className="text-muted-foreground">
                      {str(c["capacity_amps"]) || "—"} A · {str(c["transfer_method"]) || "transfer method not set"} ·{" "}
                      {str(c["normal_state"]) || "normal state not set"}
                    </span>
                    {!c["is_current"] && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="ml-auto"
                        disabled={commissionTie.isPending}
                        onClick={() => commissionTie.mutate({ id: str(c["id"]), date: null })}
                      >
                        Commission as current
                      </Button>
                    )}
                  </div>
                ))}
                <NewIntertieConfigForm
                  intertieUuid={str(tie["id"])}
                  services={(data?.services ?? []) as Row[]}
                  pending={addTieConfig.isPending}
                  onSubmit={(v) => addTieConfig.mutate(v)}
                />
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function NewServiceForm({
  onSubmit,
  pending,
}: {
  onSubmit: (v: Record<string, unknown>) => void;
  pending: boolean;
}) {
  const [serviceId, setServiceId] = useState("");
  const [name, setName] = useState("");
  const [building, setBuilding] = useState("");
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Add a service identity</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-4 items-end">
        <Field label={`Service ID (${SERVICE_ID_SHAPE})`}>
          <Input
            value={serviceId}
            placeholder="SVC-HOUSE"
            onChange={(e) => setServiceId(e.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Name">
          <Input value={name} placeholder="House service" onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Building">
          <Input value={building} onChange={(e) => setBuilding(e.target.value)} />
        </Field>
        <Button
          disabled={pending || !serviceId.trim()}
          onClick={() => {
            onSubmit({ service_id: serviceId, name: name || null, building: building || null });
            setServiceId("");
            setName("");
            setBuilding("");
          }}
        >
          Add service
        </Button>
      </CardContent>
    </Card>
  );
}

function NewConfigForm({
  serviceUuid,
  onSubmit,
  pending,
}: {
  serviceUuid: string;
  onSubmit: (v: Record<string, unknown>) => void;
  pending: boolean;
}) {
  const [state, setState] = useState<string>("planned");
  const [labelText, setLabelText] = useState("");
  const [amps, setAmps] = useState("");
  const [voltage, setVoltage] = useState("120/240");
  const [phase, setPhase] = useState("single");
  const [equipment, setEquipment] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <div className="grid gap-2 sm:grid-cols-3 items-end border-t border-border pt-3">
      <Field label="Lifecycle state">
        <Select value={state} onValueChange={setState}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SERVICE_LIFECYCLE_STATES.map((s) => (
              <SelectItem key={s} value={s}>
                {serviceLifecycleLabel(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Revision label">
        <Input
          value={labelText}
          placeholder="Proposed 400 A upgrade"
          onChange={(e) => setLabelText(e.target.value)}
        />
      </Field>
      <Field label="Service ampacity (A)">
        <Input value={amps} inputMode="numeric" onChange={(e) => setAmps(e.target.value)} />
      </Field>
      <Field label="Voltage">
        <Input value={voltage} onChange={(e) => setVoltage(e.target.value)} />
      </Field>
      <Field label="Phase">
        <Input value={phase} onChange={(e) => setPhase(e.target.value)} />
      </Field>
      <Field label="Service equipment">
        <Input value={equipment} onChange={(e) => setEquipment(e.target.value)} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Notes">
          <Textarea value={notes} rows={2} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() => {
          const n = Number(amps);
          onSubmit({
            service_uuid: serviceUuid,
            lifecycle_state: state,
            revision_label: labelText || null,
            ampacity_amps: amps.trim() && Number.isFinite(n) ? n : null,
            voltage: voltage || null,
            phase: phase || null,
            service_equipment: equipment || null,
            notes: notes || null,
          });
          setLabelText("");
          setAmps("");
          setEquipment("");
          setNotes("");
        }}
      >
        Add revision
      </Button>
    </div>
  );
}

function NewIntertieForm({
  onSubmit,
  pending,
}: {
  onSubmit: (v: Record<string, unknown>) => void;
  pending: boolean;
}) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  return (
    <div className="grid gap-2 sm:grid-cols-3 items-end">
      <Field label="Intertie ID (ITIE-<SITE_A>-<SITE_B>)">
        <Input
          value={id}
          placeholder="ITIE-HOUSE-FS"
          onChange={(e) => setId(e.target.value.toUpperCase())}
        />
      </Field>
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Button
        disabled={pending || !id.trim()}
        onClick={() => {
          onSubmit({ intertie_id: id, name: name || null });
          setId("");
          setName("");
        }}
      >
        Add intertie
      </Button>
    </div>
  );
}

function NewIntertieConfigForm({
  intertieUuid,
  services,
  onSubmit,
  pending,
}: {
  intertieUuid: string;
  services: Row[];
  onSubmit: (v: Record<string, unknown>) => void;
  pending: boolean;
}) {
  const [state, setState] = useState<string>("concept");
  const [a, setA] = useState<string>("");
  const [b, setB] = useState<string>("");
  const [capacity, setCapacity] = useState("");
  const [transfer, setTransfer] = useState("");
  const [isolation, setIsolation] = useState("");
  const [normal, setNormal] = useState("");
  const [permitted, setPermitted] = useState("");
  return (
    <div className="grid gap-2 sm:grid-cols-3 items-end border-t border-border pt-3">
      <Field label="Lifecycle state">
        <Select value={state} onValueChange={setState}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INTERTIE_LIFECYCLE_STATES.map((s) => (
              <SelectItem key={s} value={s}>
                {intertieLifecycleLabel(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Endpoint A service">
        <Select value={a} onValueChange={setA}>
          <SelectTrigger>
            <SelectValue placeholder="Select" />
          </SelectTrigger>
          <SelectContent>
            {services.map((s) => (
              <SelectItem key={str(s["id"])} value={str(s["id"])}>
                {str(s["service_id"])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Endpoint B service">
        <Select value={b} onValueChange={setB}>
          <SelectTrigger>
            <SelectValue placeholder="Select" />
          </SelectTrigger>
          <SelectContent>
            {services.map((s) => (
              <SelectItem key={str(s["id"])} value={str(s["id"])}>
                {str(s["service_id"])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Capacity (A)">
        <Input value={capacity} inputMode="numeric" onChange={(e) => setCapacity(e.target.value)} />
      </Field>
      <Field label="Transfer method">
        <Input
          value={transfer}
          placeholder="Interlocked transfer switch"
          onChange={(e) => setTransfer(e.target.value)}
        />
      </Field>
      <Field label="Isolation method">
        <Input value={isolation} onChange={(e) => setIsolation(e.target.value)} />
      </Field>
      <Field label="Normal state">
        <Input value={normal} placeholder="Open" onChange={(e) => setNormal(e.target.value)} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Permitted operating states">
          <Textarea value={permitted} rows={2} onChange={(e) => setPermitted(e.target.value)} />
        </Field>
      </div>
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() => {
          const n = Number(capacity);
          onSubmit({
            intertie_uuid: intertieUuid,
            lifecycle_state: state,
            endpoint_a_service_uuid: a || null,
            endpoint_b_service_uuid: b || null,
            capacity_amps: capacity.trim() && Number.isFinite(n) ? n : null,
            transfer_method: transfer || null,
            isolation_method: isolation || null,
            normal_state: normal || null,
            permitted_states: permitted || null,
          });
          setCapacity("");
          setTransfer("");
          setIsolation("");
          setNormal("");
          setPermitted("");
        }}
      >
        Add intertie revision
      </Button>
    </div>
  );
}
