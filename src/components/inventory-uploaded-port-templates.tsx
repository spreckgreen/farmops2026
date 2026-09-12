import { useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import type { ConnectorGender, ConnectorPolarity, SignalType } from "@/lib/inventory-connectors";

type TemplatePort = {
  id: string;
  source_name: string;
  device_name: string;
  inventory_item_type: string;
  port_name: string;
  direction: "input" | "output" | "bidirectional";
  signal_type: SignalType;
  connector_type_id: string;
  connector_gender: ConnectorGender;
  polarity: ConnectorPolarity;
  protocol: string | null;
  impedance_ohms: number | null;
  notes: string | null;
  sort_order: number;
};

const db = supabase as unknown as { from: (table: string) => any };

export function InventoryUploadedPortTemplates({
  itemId,
  itemName,
  existingPortNames,
  nextSortOrder,
  onCreated,
}: {
  itemId: string;
  itemName: string;
  existingPortNames: string[];
  nextSortOrder: number;
  onCreated: () => Promise<void>;
}) {
  const [rows, setRows] = useState<TemplatePort[]>([]);
  const [deviceName, setDeviceName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const { data, error } = await db.from("inventory_device_port_templates")
          .select("*")
          .eq("source_name", "HamConnectors080624.xlsx")
          .eq("active", true)
          .order("device_name")
          .order("sort_order");
        if (error) return toast.error(`Could not load uploaded connector reference: ${error.message}`);
        const next = data ?? [];
        setRows(next);
        const normalizedItem = itemName.trim().toLowerCase();
        const exact = next.find((row) => row.device_name.toLowerCase() === normalizedItem)?.device_name;
        setDeviceName(exact ?? "");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [itemName]);

  const deviceNames = useMemo(
    () => [...new Set(rows.map((row) => row.device_name))].sort(),
    [rows],
  );
  const shown = useMemo(
    () => rows.filter((row) => row.device_name === deviceName),
    [deviceName, rows],
  );
  const existing = useMemo(
    () => new Set(existingPortNames.map((name) => name.trim().toLowerCase())),
    [existingPortNames],
  );

  useEffect(() => {
    setSelected(
      new Set(
        shown
          .filter((row) => !existing.has(row.port_name.trim().toLowerCase()))
          .map((row) => row.id),
      ),
    );
  }, [shown, existing]);

  const apply = async () => {
    const chosen = shown
      .filter((row) => selected.has(row.id))
      .sort((a, b) => a.sort_order - b.sort_order);
    if (!chosen.length) return toast.error("Select at least one connector to apply.");
    const auth = await supabase.auth.getUser();
    const user = auth.data?.user;
    if (auth.error || !user) return toast.error("Sign in again before saving.");
    setSaving(true);
    try {
      const firstSortOrder = chosen[0]?.sort_order ?? 0;
      const payload = chosen.map((row) => ({
        user_id: user.id,
        inventory_item_id: itemId,
        name: row.port_name,
        direction: row.direction,
        signal_type: row.signal_type,
        connector_type_id: row.connector_type_id,
        connector_gender: row.connector_gender,
        polarity: row.polarity,
        protocol: row.protocol,
        impedance_ohms: row.impedance_ohms,
        notes: [row.notes, `Reviewed uploaded reference: ${row.source_name}`]
          .filter(Boolean)
          .join("\n"),
        sort_order: nextSortOrder + (row.sort_order - firstSortOrder),
      }));
      const { error } = await db.from("inventory_device_ports").insert(payload);
      if (error) throw error;
      toast.success(`${payload.length} uploaded connector${payload.length === 1 ? "" : "s"} applied`);
      await onCreated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not apply connector template.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-dashed bg-muted/20 p-3">
      <div>
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <FileSpreadsheet className="h-4 w-4" />
          Uploaded device connector reference
        </p>
        <p className="text-[11px] text-muted-foreground">
          Review and apply ports transcribed from HamConnectors080624.xlsx. Nothing is created automatically.
        </p>
      </div>
      <select
        value={deviceName}
        onChange={(event) => setDeviceName(event.target.value)}
        disabled={loading}
        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
      >
        <option value="">{loading ? "Loading uploaded devices…" : "Choose uploaded device…"}</option>
        {deviceNames.map((name) => <option key={name} value={name}>{name}</option>)}
      </select>
      {shown.map((row) => {
        const alreadyExists = existing.has(row.port_name.trim().toLowerCase());
        return (
          <label key={row.id} className="flex items-start gap-2 rounded border bg-background p-2 text-xs">
            <input
              type="checkbox"
              className="mt-0.5"
              disabled={alreadyExists}
              checked={!alreadyExists && selected.has(row.id)}
              onChange={(event) => {
                const next = new Set(selected);
                if (event.target.checked) next.add(row.id);
                else next.delete(row.id);
                setSelected(next);
              }}
            />
            <span>
              <span className="font-medium">{row.port_name}</span>
              <span className="text-muted-foreground">
                {" "}· {row.direction} · {row.connector_type_id} · {row.connector_gender}
                {row.protocol ? ` · ${row.protocol}` : ""}
                {row.impedance_ohms ? ` · ${row.impedance_ohms} Ω` : ""}
                {alreadyExists ? " · already recorded" : ""}
              </span>
            </span>
          </label>
        );
      })}
      {shown.length ? (
        <Button type="button" size="sm" className="w-full" disabled={saving} onClick={() => void apply()}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          {saving ? "Applying…" : "Apply selected connectors"}
        </Button>
      ) : null}
    </div>
  );
}
