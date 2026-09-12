import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import {
  discoverEquipmentPorts,
  type EquipmentPortDiscovery,
  type EquipmentPortProposal,
} from "@/lib/inventory-equipment-connectors.functions";
import type {
  ConnectorGender,
  ConnectorPolarity,
  ConnectorRef,
  SignalType,
} from "@/lib/inventory-connectors";

type Props = {
  itemId: string;
  manufacturer: string;
  model: string;
  connectors: ConnectorRef[];
  existingPortNames: string[];
  onCreated: () => Promise<void>;
};

const directions = ["input", "output", "bidirectional"] as const;
const signals: SignalType[] = ["rf", "data", "power", "display", "audio", "control", "other"];
const genders: ConnectorGender[] = ["male", "female", "plug", "receptacle", "genderless"];
const polarities: ConnectorPolarity[] = ["standard", "reverse", "not_applicable"];

export function InventoryEquipmentPortDiscovery({
  itemId,
  manufacturer: initialManufacturer,
  model: initialModel,
  connectors,
  existingPortNames,
  onCreated,
}: Props) {
  const discover = useServerFn(discoverEquipmentPorts);
  const [manufacturer, setManufacturer] = useState(initialManufacturer);
  const [model, setModel] = useState(initialModel);
  const [result, setResult] = useState<EquipmentPortDiscovery | null>(null);
  const [proposals, setProposals] = useState<EquipmentPortProposal[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);

  const patch = (id: string, changes: Partial<EquipmentPortProposal>) =>
    setProposals((rows) => rows.map((row) => (row.id === id ? { ...row, ...changes } : row)));

  const runSearch = async () => {
    if (!manufacturer.trim() || !model.trim()) {
      toast.error("Manufacturer and exact model are required.");
      return;
    }
    setSearching(true);
    try {
      const found = await discover({ data: { manufacturer, model } });
      setResult(found);
      setProposals(
        found.proposals.map((proposal) => ({
          ...proposal,
          selected:
            proposal.confidence === "high" &&
            !existingPortNames.some((name) => name.toLowerCase() === proposal.name.toLowerCase()),
        })),
      );
      if (!found.proposals.length) toast.info("No supported port proposals were found.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Equipment lookup failed.");
    } finally {
      setSearching(false);
    }
  };

  const createSelected = async () => {
    const selected = proposals.filter((proposal) => proposal.selected);
    if (!selected.length) {
      toast.error("Select at least one reviewed port.");
      return;
    }
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      toast.error("Sign in again before saving.");
      return;
    }
    setSaving(true);
    try {
      const rows = selected.map((proposal, index) => ({
        user_id: auth.user!.id,
        inventory_item_id: itemId,
        name: proposal.name.trim(),
        direction: proposal.direction,
        signal_type: proposal.signal_type,
        connector_type_id: proposal.connector_type_id,
        connector_gender: proposal.connector_gender,
        polarity: proposal.polarity,
        protocol: proposal.protocol?.trim() || null,
        impedance_ohms: proposal.impedance_ohms,
        notes: [
          proposal.notes,
          `Reviewed equipment lookup: ${proposal.source_title} (${proposal.source_url})`,
          `Evidence: ${proposal.evidence}`,
          `Lookup confidence: ${proposal.confidence}`,
        ].filter(Boolean).join("\n"),
        sort_order: existingPortNames.length + index,
      }));
      const { error } = await (supabase as any).from("inventory_device_ports").insert(rows);
      if (error) throw error;
      toast.success(`${rows.length} reviewed port${rows.length === 1 ? "" : "s"} created`);
      setProposals((current) => current.filter((proposal) => !proposal.selected));
      await onCreated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create selected ports.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-dashed border-primary/40 bg-primary/5 p-3">
      <div>
        <Label>Ham Radio / Communications equipment lookup</Label>
        <p className="text-[11px] text-muted-foreground">
          Searches public documentation by exact manufacturer and model. Results remain proposals until you review and create them.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input
          className="h-8 text-xs"
          value={manufacturer}
          onChange={(event) => setManufacturer(event.target.value)}
          placeholder="Manufacturer, e.g. Kenwood"
        />
        <Input
          className="h-8 text-xs"
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder="Exact model, e.g. TS-480SAT"
        />
        <Button type="button" size="sm" className="col-span-2" disabled={searching} onClick={() => void runSearch()}>
          <Search className="mr-1 h-3.5 w-3.5" />
          {searching ? "Searching documentation…" : "Find equipment connections"}
        </Button>
      </div>

      {result ? (
        <div className="space-y-2">
          {!result.exact_model_match ? (
            <p className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-600">
              Exact model evidence was not established. No ports can be created from this result.
            </p>
          ) : null}
          {result.warnings.map((warning) => (
            <p key={warning} className="text-xs text-amber-600">{warning}</p>
          ))}
          {proposals.map((proposal) => (
            <div key={proposal.id} className="space-y-2 rounded border bg-background p-2 text-xs">
              <div className="flex items-start gap-2">
                <input
                  aria-label={`Select ${proposal.name}`}
                  type="checkbox"
                  checked={proposal.selected}
                  onChange={(event) => patch(proposal.id, { selected: event.target.checked })}
                  className="mt-1"
                />
                <Input
                  className="h-8 flex-1 text-xs"
                  value={proposal.name}
                  onChange={(event) => patch(proposal.id, { name: event.target.value })}
                />
                <span className={
                  proposal.confidence === "high"
                    ? "rounded bg-emerald-500/15 px-2 py-1 text-emerald-600"
                    : "rounded bg-amber-500/15 px-2 py-1 text-amber-600"
                }>
                  {proposal.confidence}
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  aria-label={`Ignore ${proposal.name}`}
                  onClick={() => setProposals((rows) => rows.filter((row) => row.id !== proposal.id))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select className="h-8 rounded border bg-background px-2" value={proposal.direction} onChange={(event) => patch(proposal.id, { direction: event.target.value as EquipmentPortProposal["direction"] })}>
                  {directions.map((value) => <option key={value}>{value}</option>)}
                </select>
                <select className="h-8 rounded border bg-background px-2" value={proposal.signal_type} onChange={(event) => patch(proposal.id, { signal_type: event.target.value as SignalType })}>
                  {signals.map((value) => <option key={value}>{value}</option>)}
                </select>
                <select className="h-8 rounded border bg-background px-2" value={proposal.connector_type_id} onChange={(event) => patch(proposal.id, { connector_type_id: event.target.value })}>
                  {connectors.map((connector) => <option key={connector.id} value={connector.id}>{connector.display_name}</option>)}
                </select>
                <select className="h-8 rounded border bg-background px-2" value={proposal.connector_gender} onChange={(event) => patch(proposal.id, { connector_gender: event.target.value as ConnectorGender })}>
                  {genders.map((value) => <option key={value}>{value}</option>)}
                </select>
                <select className="h-8 rounded border bg-background px-2" value={proposal.polarity} onChange={(event) => patch(proposal.id, { polarity: event.target.value as ConnectorPolarity })}>
                  {polarities.map((value) => <option key={value}>{value}</option>)}
                </select>
                <Input
                  className="h-8 text-xs"
                  type="number"
                  min="0"
                  value={proposal.impedance_ohms ?? ""}
                  placeholder="Impedance Ω"
                  onChange={(event) => patch(proposal.id, { impedance_ohms: event.target.value ? Number(event.target.value) : null })}
                />
                <Input
                  className="col-span-2 h-8 text-xs"
                  value={proposal.protocol ?? ""}
                  placeholder="Protocol/capability"
                  onChange={(event) => patch(proposal.id, { protocol: event.target.value || null })}
                />
              </div>
              <p className="text-muted-foreground">Evidence: {proposal.evidence}</p>
              <a className="inline-flex items-center gap-1 text-primary hover:underline" href={proposal.source_url} target="_blank" rel="noreferrer">
                {proposal.source_title}<ExternalLink className="h-3 w-3" />
              </a>
            </div>
          ))}
          {proposals.length ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">
                High-confidence proposals start selected; all others require explicit approval.
              </span>
              <Button type="button" size="sm" disabled={saving || !proposals.some((proposal) => proposal.selected)} onClick={() => void createSelected()}>
                {saving ? "Creating…" : "Create selected ports"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
