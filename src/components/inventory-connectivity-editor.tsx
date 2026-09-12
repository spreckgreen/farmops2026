import { useEffect, useMemo, useState } from "react";
import { Cable, ChevronDown, ChevronRight, Link2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  cableCompatibility,
  connectorSearchText,
  type CableEnd,
  type CableSpec,
  type ConnectorGender,
  type ConnectorRef,
  type DevicePort,
  type SignalType,
} from "@/lib/inventory-connectors";

type InventoryChoice = { id: string; name: string | null; sku: string | null };
type CableRow = Omit<CableSpec, "ends"> & { ends: CableEnd[]; item?: InventoryChoice };

const blankPort = {
  name: "",
  direction: "bidirectional" as const,
  signal_type: "other" as SignalType,
  connector_type_id: "",
  connector_gender: "receptacle" as ConnectorGender,
  polarity: "standard" as const,
  protocol: "",
  impedance_ohms: "",
  notes: "",
};

const genders: ConnectorGender[] = ["male", "female", "plug", "receptacle", "genderless"];
const signals: SignalType[] = ["rf", "data", "power", "display", "audio", "control", "other"];

const numberOrNull = (value: string) => {
  const n = Number(value);
  return value.trim() && Number.isFinite(n) ? n : null;
};

// New migration tables are intentionally accessed through a narrow dynamic client
// until the generated Supabase types are refreshed by the deployment workflow.
const db = supabase as unknown as { from: (table: string) => any };

function ConnectorPicker({
  connectors,
  value,
  onChange,
}: {
  connectors: ConnectorRef[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [search, setSearch] = useState("");
  const shown = connectors.filter((connector) =>
    connectorSearchText(connector).includes(search.trim().toLowerCase()),
  );

  return (
    <div className="space-y-1">
      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search BNC, SMA, PL-259, USB-C…"
        className="h-8 text-xs"
      />
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
      >
        <option value="">Choose connector…</option>
        {shown.map((connector) => (
          <option key={connector.id} value={connector.id}>
            {connector.display_name}
          </option>
        ))}
      </select>
      {value ? (
        <p className="text-[11px] text-muted-foreground">
          {connectors.find((connector) => connector.id === value)?.description}
        </p>
      ) : null}
    </div>
  );
}

export function InventoryConnectivityEditor({
  itemId,
  itemName,
}: {
  itemId: string;
  itemName: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [connectors, setConnectors] = useState<ConnectorRef[]>([]);
  const [ports, setPorts] = useState<DevicePort[]>([]);
  const [cables, setCables] = useState<CableRow[]>([]);
  const [inventory, setInventory] = useState<InventoryChoice[]>([]);
  const [cableSpec, setCableSpec] = useState<CableRow | null>(null);
  const [portForm, setPortForm] = useState(blankPort);
  const [selectedPortId, setSelectedPortId] = useState("");
  const [editingCable, setEditingCable] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [catalogRes, portsRes, specsRes, endsRes, itemsRes] = await Promise.all([
        db.from("connector_types").select("id,family,display_name,description,aliases,mating_key").eq("active", true).order("family").order("display_name"),
        db.from("inventory_device_ports").select("*").eq("inventory_item_id", itemId).order("sort_order").order("name"),
        db.from("inventory_cable_specs").select("*"),
        db.from("inventory_cable_ends").select("*").order("end_label"),
        db.from("inventory_items").select("id,name,sku").order("name"),
      ]);
      for (const result of [catalogRes, portsRes, specsRes, endsRes, itemsRes]) {
        if (result.error) throw result.error;
      }
      const connectorRows = (catalogRes.data ?? []) as ConnectorRef[];
      const itemRows = (itemsRes.data ?? []) as InventoryChoice[];
      const itemMap = new Map(itemRows.map((item) => [item.id, item]));
      const endRows = (endsRes.data ?? []) as CableEnd[];
      const cableRows = ((specsRes.data ?? []) as Array<Omit<CableRow, "ends">>).map((spec) => ({
        ...spec,
        ends: endRows.filter((end: any) => end.cable_item_id === spec.inventory_item_id),
        item: itemMap.get(spec.inventory_item_id),
      }));
      setConnectors(connectorRows);
      setPorts((portsRes.data ?? []) as DevicePort[]);
      setInventory(itemRows);
      setCables(cableRows);
      setCableSpec(cableRows.find((cable) => cable.inventory_item_id === itemId) ?? null);
    } catch (error) {
      toast.error(`Could not load connection details: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void load();
  }, [open, itemId]);

  const selectedPort = ports.find((port) => port.id === selectedPortId) ?? null;
  const matches = useMemo(() => {
    if (!selectedPort) return [];
    return cables
      .filter((cable) => cable.inventory_item_id !== itemId)
      .map((cable) => ({
        cable,
        result: cableCompatibility(selectedPort, cable, connectors),
      }))
      .filter(({ result }) => result.compatible)
      .sort((a, b) => a.result.warnings.length - b.result.warnings.length);
  }, [cables, connectors, itemId, selectedPort]);

  const addPort = async () => {
    if (!portForm.name.trim() || !portForm.connector_type_id) {
      toast.error("Port name and connector are required.");
      return;
    }
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return toast.error("Sign in again before saving.");
    const payload = {
      user_id: auth.user.id,
      inventory_item_id: itemId,
      name: portForm.name.trim(),
      direction: portForm.direction,
      signal_type: portForm.signal_type,
      connector_type_id: portForm.connector_type_id,
      connector_gender: portForm.connector_gender,
      polarity: portForm.polarity,
      protocol: portForm.protocol.trim() || null,
      impedance_ohms: numberOrNull(portForm.impedance_ohms),
      notes: portForm.notes.trim() || null,
      sort_order: ports.length,
    };
    const { error } = await db.from("inventory_device_ports").insert(payload);
    if (error) return toast.error(error.message);
    setPortForm(blankPort);
    toast.success("Device port added");
    await load();
  };

  const removePort = async (id: string) => {
    const { error } = await db.from("inventory_device_ports").delete().eq("id", id);
    if (error) return toast.error(error.message);
    if (selectedPortId === id) setSelectedPortId("");
    await load();
  };

  const saveCable = async (form: HTMLFormElement) => {
    const values = new FormData(form);
    const connectorA = String(values.get("connector_a") ?? "");
    const connectorB = String(values.get("connector_b") ?? "");
    if (!connectorA || !connectorB) return toast.error("Both cable ends are required.");
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return toast.error("Sign in again before saving.");
    const userId = auth.user.id;
    const spec = {
      inventory_item_id: itemId,
      user_id: userId,
      cable_type: String(values.get("cable_type") ?? "").trim() || null,
      length: numberOrNull(String(values.get("length") ?? "")),
      length_unit: String(values.get("length_unit") ?? "ft"),
      awg: numberOrNull(String(values.get("awg") ?? "")),
      impedance_ohms: numberOrNull(String(values.get("impedance") ?? "")),
      shielding: String(values.get("shielding") ?? "").trim() || null,
      signal_types: values.getAll("signal_types").map(String),
      protocol: String(values.get("protocol") ?? "").trim() || null,
      max_frequency_hz: numberOrNull(String(values.get("max_frequency_hz") ?? "")),
      max_current_a: numberOrNull(String(values.get("max_current_a") ?? "")),
      max_power_w: numberOrNull(String(values.get("max_power_w") ?? "")),
      adapter_or_pigtail: values.get("adapter_or_pigtail") === "on",
    };
    const { error: specError } = await db.from("inventory_cable_specs").upsert(spec);
    if (specError) return toast.error(specError.message);
    const ends = [
      {
        user_id: userId,
        cable_item_id: itemId,
        end_label: "A",
        connector_type_id: connectorA,
        connector_gender: String(values.get("gender_a") ?? "plug"),
        polarity: String(values.get("polarity_a") ?? "standard"),
      },
      {
        user_id: userId,
        cable_item_id: itemId,
        end_label: "B",
        connector_type_id: connectorB,
        connector_gender: String(values.get("gender_b") ?? "plug"),
        polarity: String(values.get("polarity_b") ?? "standard"),
      },
    ];
    const { error: endsError } = await db
      .from("inventory_cable_ends")
      .upsert(ends, { onConflict: "cable_item_id,end_label" });
    if (endsError) return toast.error(endsError.message);
    toast.success("Cable specification saved");
    setEditingCable(false);
    await load();
  };

  const end = (label: "A" | "B") => cableSpec?.ends.find((candidate) => candidate.end_label === label);

  return (
    <section className="col-span-2 rounded-md border border-border/70">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          <Link2 className="h-4 w-4" />
          Connections and compatible cables
        </span>
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      {open ? (
        <div className="space-y-4 border-t border-border/70 p-3">
          {loading ? <p className="text-sm text-muted-foreground">Loading connections…</p> : null}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Device ports</Label>
              <span className="text-[11px] text-muted-foreground">
                Radios, tuners, amplifiers, computers and peripherals
              </span>
            </div>
            {ports.map((port) => {
              const connector = connectors.find((candidate) => candidate.id === port.connector_type_id);
              return (
                <div key={port.id} className="flex items-center gap-2 rounded border px-2 py-1.5 text-xs">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setSelectedPortId(port.id)}
                  >
                    <span className="font-medium">{port.name}</span>
                    <span className="text-muted-foreground">
                      {" "}· {port.direction} · {connector?.display_name ?? port.connector_type_id} · {port.connector_gender}
                      {port.protocol ? ` · ${port.protocol}` : ""}
                      {port.impedance_ohms ? ` · ${port.impedance_ohms} Ω` : ""}
                    </span>
                  </button>
                  <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => void removePort(port.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
            <div className="grid grid-cols-2 gap-2 rounded-md bg-muted/30 p-2">
              <Input className="h-8 text-xs" placeholder="Port name, e.g. Antenna 1" value={portForm.name} onChange={(e) => setPortForm({ ...portForm, name: e.target.value })} />
              <select className="h-8 rounded-md border bg-background px-2 text-xs" value={portForm.direction} onChange={(e) => setPortForm({ ...portForm, direction: e.target.value as typeof portForm.direction })}>
                <option value="input">Input</option><option value="output">Output</option><option value="bidirectional">Bidirectional</option>
              </select>
              <select className="h-8 rounded-md border bg-background px-2 text-xs" value={portForm.signal_type} onChange={(e) => setPortForm({ ...portForm, signal_type: e.target.value as SignalType })}>
                {signals.map((signal) => <option key={signal} value={signal}>{signal}</option>)}
              </select>
              <select className="h-8 rounded-md border bg-background px-2 text-xs" value={portForm.connector_gender} onChange={(e) => setPortForm({ ...portForm, connector_gender: e.target.value as ConnectorGender })}>
                {genders.map((gender) => <option key={gender} value={gender}>{gender}</option>)}
              </select>
              <div className="col-span-2"><ConnectorPicker connectors={connectors} value={portForm.connector_type_id} onChange={(value) => setPortForm({ ...portForm, connector_type_id: value })} /></div>
              <Input className="h-8 text-xs" placeholder="Protocol/capability, e.g. USB 10 Gbps" value={portForm.protocol} onChange={(e) => setPortForm({ ...portForm, protocol: e.target.value })} />
              <Input className="h-8 text-xs" type="number" placeholder="Impedance Ω" value={portForm.impedance_ohms} onChange={(e) => setPortForm({ ...portForm, impedance_ohms: e.target.value })} />
              <Input className="col-span-2 h-8 text-xs" placeholder="Port notes" value={portForm.notes} onChange={(e) => setPortForm({ ...portForm, notes: e.target.value })} />
              <Button type="button" size="sm" className="col-span-2" onClick={() => void addPort()}><Plus className="mr-1 h-3.5 w-3.5" />Add port</Button>
            </div>
          </div>

          {selectedPort ? (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-2">
              <p className="text-xs font-medium">Compatible inventory cables for {selectedPort.name}</p>
              {matches.length ? matches.map(({ cable, result }) => (
                <div key={cable.inventory_item_id} className="mt-1 text-xs">
                  <span className="font-medium">{cable.item?.name ?? cable.inventory_item_id}</span>
                  <span className="text-muted-foreground"> · {result.orientation}{cable.length ? ` · ${cable.length} ${cable.length_unit}` : " · length unknown"}{cable.awg ? ` · ${cable.awg} AWG` : ""}</span>
                  {result.warnings.length ? <span className="text-amber-500"> · {result.warnings.join(" ")}</span> : null}
                </div>
              )) : <p className="mt-1 text-xs text-muted-foreground">No compatible cables are currently recorded.</p>}
            </div>
          ) : ports.length ? (
            <p className="text-xs text-muted-foreground">Select a device port to show compatible cable inventory.</p>
          ) : null}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5"><Cable className="h-4 w-4" />Cable inventory details</Label>
              <Button type="button" size="sm" variant="outline" onClick={() => setEditingCable((value) => !value)}>
                {cableSpec ? "Edit cable" : "Mark as cable"}
              </Button>
            </div>
            {cableSpec && !editingCable ? (
              <p className="text-xs text-muted-foreground">
                {cableSpec.cable_type || "Cable type unknown"} · {cableSpec.length ?? "length unknown"} {cableSpec.length ? cableSpec.length_unit : ""}
                {cableSpec.awg ? ` · ${cableSpec.awg} AWG` : ""}
                {cableSpec.impedance_ohms ? ` · ${cableSpec.impedance_ohms} Ω` : ""}
                {" · "}{end("A")?.connector_type_id ?? "End A missing"} to {end("B")?.connector_type_id ?? "End B missing"}
              </p>
            ) : null}
            {editingCable ? (
              <form className="grid grid-cols-2 gap-2 rounded-md bg-muted/30 p-2" onSubmit={(event) => { event.preventDefault(); void saveCable(event.currentTarget); }}>
                <Input name="cable_type" defaultValue={cableSpec?.cable_type ?? ""} placeholder="Cable type, e.g. RG-8X" className="h-8 text-xs" />
                <Input name="protocol" defaultValue={cableSpec?.protocol ?? ""} placeholder="Protocol/capability" className="h-8 text-xs" />
                <Input name="length" type="number" step="any" min="0" defaultValue={cableSpec?.length ?? ""} placeholder="Length" className="h-8 text-xs" />
                <select name="length_unit" defaultValue={cableSpec?.length_unit ?? "ft"} className="h-8 rounded-md border bg-background px-2 text-xs"><option>in</option><option>ft</option><option>mm</option><option>cm</option><option>m</option></select>
                <Input name="awg" type="number" min="0" max="60" defaultValue={cableSpec?.awg ?? ""} placeholder="AWG" className="h-8 text-xs" />
                <Input name="impedance" type="number" min="0" defaultValue={cableSpec?.impedance_ohms ?? ""} placeholder="Impedance Ω" className="h-8 text-xs" />
                <Input name="shielding" defaultValue={(cableSpec as any)?.shielding ?? ""} placeholder="Shielding" className="h-8 text-xs" />
                <Input name="max_frequency_hz" type="number" min="0" defaultValue={cableSpec?.max_frequency_hz ?? ""} placeholder="Max frequency Hz" className="h-8 text-xs" />
                <Input name="max_current_a" type="number" min="0" step="any" defaultValue={cableSpec?.max_current_a ?? ""} placeholder="Max current A" className="h-8 text-xs" />
                <Input name="max_power_w" type="number" min="0" step="any" defaultValue={cableSpec?.max_power_w ?? ""} placeholder="Max power W" className="h-8 text-xs" />
                <fieldset className="col-span-2 flex flex-wrap gap-3 text-xs">
                  <legend className="mb-1 text-muted-foreground">Suitable signal types</legend>
                  {signals.map((signal) => <label key={signal} className="flex items-center gap-1"><input type="checkbox" name="signal_types" value={signal} defaultChecked={cableSpec?.signal_types?.includes(signal)} />{signal}</label>)}
                </fieldset>
                {(["A", "B"] as const).map((label) => (
                  <fieldset key={label} className="space-y-2 rounded border p-2">
                    <legend className="px-1 text-xs font-medium">End {label}</legend>
                    <ConnectorPicker connectors={connectors} value={end(label)?.connector_type_id ?? ""} onChange={(value) => {
                      const select = document.querySelector<HTMLSelectElement>(`select[name="connector_${label.toLowerCase()}"]`);
                      if (select) select.value = value;
                    }} />
                    <select name={`connector_${label.toLowerCase()}`} defaultValue={end(label)?.connector_type_id ?? ""} className="hidden" aria-hidden="true"><option value={end(label)?.connector_type_id ?? ""} /></select>
                    <select name={`gender_${label.toLowerCase()}`} defaultValue={end(label)?.connector_gender ?? "plug"} className="h-8 w-full rounded-md border bg-background px-2 text-xs">{genders.map((gender) => <option key={gender} value={gender}>{gender}</option>)}</select>
                    <select name={`polarity_${label.toLowerCase()}`} defaultValue={end(label)?.polarity ?? "standard"} className="h-8 w-full rounded-md border bg-background px-2 text-xs"><option value="standard">standard polarity</option><option value="reverse">reverse polarity</option><option value="not_applicable">not applicable</option></select>
                  </fieldset>
                ))}
                <label className="col-span-2 flex items-center gap-2 text-xs"><input name="adapter_or_pigtail" type="checkbox" defaultChecked={cableSpec?.adapter_or_pigtail} />Adapter or pigtail</label>
                <Button type="submit" size="sm" className="col-span-2">Save cable specification</Button>
              </form>
            ) : null}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Connector shape, protocol, impedance and ratings are checked independently. Unknown values remain warnings instead of being invented.
          </p>
        </div>
      ) : null}
    </section>
  );
}

export default InventoryConnectivityEditor;
