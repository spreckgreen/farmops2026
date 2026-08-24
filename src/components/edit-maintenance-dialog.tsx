import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Gauge } from "lucide-react";
import { updateMaintenance, logAssetUsage } from "@/lib/maintenance.functions";
import { supabase } from "@/integrations/supabase/client";

export type MaintenanceRow = {
  id: string;
  asset_id?: string | null;
  asset_name?: string | null;
  title?: string | null;
  service_type?: string | null;
  status?: string | null;
  description?: string | null;
  performed_at?: string | null;
  due_at?: string | null;
  scheduled_date?: string | null;
  cost?: number | string | null;
  vendor?: string | null;
  notes?: string | null;
};

type AssetUsage = {
  id: string;
  name: string | null;
  current_hours: number | null;
  current_miles: number | null;
  usage_tracking: string | null;
};

const dateOnly = (v: unknown) => (v ? String(v).slice(0, 10) : "");

export function EditMaintenanceDialog({
  record,
  onOpenChange,
}: {
  record: MaintenanceRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const updateFn = useServerFn(updateMaintenance);
  const usageFn = useServerFn(logAssetUsage);

  const [form, setForm] = useState({
    title: "",
    asset_name: "",
    service_type: "",
    status: "",
    scheduled_date: "",
    performed_at: "",
    due_at: "",
    cost: "",
    vendor: "",
    notes: "",
  });
  const [assets, setAssets] = useState<AssetUsage[]>([]);
  const [assetId, setAssetId] = useState<string>("");
  const [hours, setHours] = useState("");
  const [miles, setMiles] = useState("");
  const asset = assets.find((a) => a.id === assetId) ?? null;

  useEffect(() => {
    if (!record) return;
    setForm({
      title: record.title ?? "",
      asset_name: record.asset_name ?? "",
      service_type: record.service_type ?? "",
      status: record.status ?? "",
      scheduled_date: dateOnly(record.scheduled_date),
      performed_at: dateOnly(record.performed_at),
      due_at: dateOnly(record.due_at),
      cost: record.cost != null ? String(record.cost) : "",
      vendor: record.vendor ?? "",
      notes: record.notes ?? "",
    });
    setHours("");
    setMiles("");
  }, [record]);

  // Load equipment so the record can be linked explicitly by id (names drift).
  useEffect(() => {
    if (!record) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("id, name, current_hours, current_miles, usage_tracking")
        .order("name", { ascending: true })
        .limit(1000);
      if (cancelled || error || !data) return;
      const list = data as AssetUsage[];
      setAssets(list);

      const wanted = (record.asset_name ?? "").trim().toLowerCase();
      const match =
        (record.asset_id && list.find((a) => a.id === record.asset_id)) ||
        list.find((a) => (a.name ?? "").trim().toLowerCase() === wanted) ||
        list.find(
          (a) => wanted.length > 3 && (a.name ?? "").trim().toLowerCase().includes(wanted),
        ) ||
        null;
      setAssetId(match?.id ?? "");
      if (match) {
        setHours(match.current_hours != null ? String(match.current_hours) : "");
        setMiles(match.current_miles != null ? String(match.current_miles) : "");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [record]);

  // Keep readings in sync when the user switches the linked asset.
  useEffect(() => {
    if (!asset) return;
    setHours(asset.current_hours != null ? String(asset.current_hours) : "");
    setMiles(asset.current_miles != null ? String(asset.current_miles) : "");
  }, [assetId]);

  const save = useMutation({
    mutationFn: async () => {
      if (!record) return;
      await updateFn({
        data: {
          id: record.id,
          title: form.title.trim() || null,
          asset_name: form.asset_name.trim() || undefined,
          service_type: form.service_type.trim() || null,
          status: form.status.trim() || null,
          scheduled_date: form.scheduled_date || null,
          performed_at: form.performed_at || null,
          due_at: form.due_at || null,
          cost: form.cost.trim() || null,
          vendor: form.vendor.trim() || null,
          notes: form.notes.trim() || null,
        } as never,
      });

      const hoursChanged =
        hours.trim() !== "" && Number(hours) !== Number(asset?.current_hours ?? NaN);
      const milesChanged =
        miles.trim() !== "" && Number(miles) !== Number(asset?.current_miles ?? NaN);
      if (asset && (hoursChanged || milesChanged)) {
        await usageFn({
          data: {
            asset_id: asset.id,
            hours: hoursChanged ? hours : null,
            miles: milesChanged ? miles : null,
          } as never,
        });
      }
    },
    onSuccess: () => {
      toast.success("Record updated");
      qc.invalidateQueries({ queryKey: ["maintenance"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });

  const field = (
    key: keyof typeof form,
    label: string,
    type: "text" | "number" | "date" = "text",
    span = false,
  ) => (
    <div className={span ? "col-span-2" : "col-span-2 sm:col-span-1"}>
      <Label htmlFor={`edit-${key}`} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={`edit-${key}`}
        type={type}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="mt-1 bg-card/60 border-border"
      />
    </div>
  );

  return (
    <Dialog open={!!record} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit maintenance record</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Update the service details and log current usage for this asset.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          {field("asset_name", "Asset")}
          {field("title", "Title")}
          {field("service_type", "Service type")}
          {field("status", "Status")}
          {field("scheduled_date", "Scheduled date", "date")}
          {field("performed_at", "Performed on", "date")}
          {field("due_at", "Next due", "date")}
          {field("cost", "Cost", "number")}
          {field("vendor", "Vendor / Technician")}
          <div className="col-span-2">
            <Label htmlFor="edit-notes" className="text-xs text-muted-foreground">
              Notes
            </Label>
            <Textarea
              id="edit-notes"
              rows={3}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="mt-1 bg-card/60 border-border"
            />
          </div>
        </div>

        <div className="mt-2 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Gauge className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Asset usage</span>
          </div>
          {asset ? (
            <>
              <p className="text-xs text-muted-foreground mb-3">
                {asset.name} — currently {asset.current_hours ?? 0} h / {asset.current_miles ?? 0} mi.
                Saving a new reading records a usage snapshot used by forecasting.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="edit-hours" className="text-xs text-muted-foreground">
                    Hours of usage
                  </Label>
                  <Input
                    id="edit-hours"
                    type="number"
                    step="0.1"
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
                    className="mt-1 bg-card/60 border-border"
                  />
                </div>
                <div>
                  <Label htmlFor="edit-miles" className="text-xs text-muted-foreground">
                    Miles
                  </Label>
                  <Input
                    id="edit-miles"
                    type="number"
                    step="0.1"
                    value={miles}
                    onChange={(e) => setMiles(e.target.value)}
                    className="mt-1 bg-card/60 border-border"
                  />
                </div>
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              No matching inventory item for “{form.asset_name || "—"}”. Add it under Inventory to
              track hours and miles.
            </p>
          )}
        </div>

        <DialogFooter className="mt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-glow"
          >
            {save.isPending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
