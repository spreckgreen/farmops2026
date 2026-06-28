import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Asset } from "@/components/dashboard/types";
import type { Consumable, ServiceSchedule, ServiceScheduleFormData, ConsumableUsage } from "@/types/scheduling";
import { Plus, X } from "lucide-react";

interface ScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: ServiceScheduleFormData) => void;
  schedule: ServiceSchedule | null;
  assets: Asset[];
  consumables: Consumable[];
}

const emptyForm: ServiceScheduleFormData = {
  asset_id: "",
  title: "",
  description: "",
  service_type: "maintenance",
  scheduled_date: "",
  recurrence: "none",
  recurrence_interval: 1,
  recurrence_unit: "days",
  trigger_type: "date",
  trigger_value: 0,
  consumables_used: [],
  notes: "",
};

const ScheduleDialog = ({ open, onOpenChange, onSave, schedule, assets, consumables }: ScheduleDialogProps) => {
  const [form, setForm] = useState<ServiceScheduleFormData>(emptyForm);
  const selectedAsset = assets.find((a) => a.id === form.asset_id);

  useEffect(() => {
    if (schedule) {
      const rec = schedule.recurrence || "none";
      let interval = 1;
      let unit = "days";
      if (rec.startsWith("custom:")) {
        const parts = rec.replace("custom:", "").split(":");
        interval = parseInt(parts[0]) || 1;
        unit = parts[1] || "days";
      }
      const triggerType =
        rec.startsWith("custom:") && (unit === "hours" || unit === "miles") ? unit : "date";
      setForm({
        asset_id: schedule.asset_id,
        title: schedule.title,
        description: schedule.description || "",
        service_type: schedule.service_type,
        scheduled_date: schedule.scheduled_date ? schedule.scheduled_date.slice(0, 16) : "",
        recurrence: rec.startsWith("custom:") ? "custom" : rec,
        recurrence_interval: interval,
        recurrence_unit: unit,
        trigger_type: triggerType,
        trigger_value: interval,
        consumables_used: schedule.consumables_used || [],
        notes: schedule.notes || "",
      });
    } else {
      setForm({ ...emptyForm, asset_id: assets[0]?.id || "" });
    }
  }, [schedule, open, assets]);

  const addConsumable = () => {
    if (consumables.length === 0) return;
    const first = consumables[0];
    setForm({
      ...form,
      consumables_used: [
        ...form.consumables_used,
        { consumable_id: first.id, name: first.name, quantity_used: 1, unit: first.unit || "pcs" },
      ],
    });
  };

  const updateConsumable = (index: number, field: string, value: string | number) => {
    const updated = [...form.consumables_used];
    if (field === "consumable_id") {
      const c = consumables.find((c) => c.id === value);
      updated[index] = { ...updated[index], consumable_id: String(value), name: c?.name || "", unit: c?.unit || "pcs" };
    } else {
      (updated[index] as unknown as Record<string, unknown>)[field] = value;
    }
    setForm({ ...form, consumables_used: updated });
  };

  const removeConsumable = (index: number) => {
    setForm({ ...form, consumables_used: form.consumables_used.filter((_, i) => i !== index) });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const submitData: ServiceScheduleFormData = { ...form };
    if (form.trigger_type === "hours" || form.trigger_type === "miles") {
      // Usage-based triggers persist as custom:<interval>:<hours|miles>
      submitData.recurrence = `custom:${form.trigger_value || 1}:${form.trigger_type}`;
      submitData.recurrence_interval = form.trigger_value || 1;
      submitData.recurrence_unit = form.trigger_type;
    } else if (form.recurrence === "custom") {
      submitData.recurrence = `custom:${form.recurrence_interval}:${form.recurrence_unit}`;
    }
    onSave(submitData);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-card border-border max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading">{schedule ? "Edit Service" : "Schedule Service"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-2">
              <Label>Title *</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            </div>

            <div className="col-span-2 space-y-2">
              <Label>Asset *</Label>
              <select
                value={form.asset_id}
                onChange={(e) => setForm({ ...form, asset_id: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                required
              >
                <option value="">Select asset...</option>
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label>Service Type</Label>
              <select
                value={form.service_type}
                onChange={(e) => setForm({ ...form, service_type: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="maintenance">Maintenance</option>
                <option value="inspection">Inspection</option>
                <option value="repair">Repair</option>
                <option value="calibration">Calibration</option>
                <option value="cleaning">Cleaning</option>
                <option value="replacement">Replacement</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label>Trigger</Label>
              <select
                value={form.trigger_type}
                onChange={(e) => setForm({ ...form, trigger_type: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="date">Date / calendar</option>
                <option value="hours">Operating hours</option>
                <option value="miles">Mileage</option>
              </select>
            </div>

            {form.trigger_type === "date" && (
              <div className="space-y-2">
                <Label>Recurrence</Label>
                <select
                  value={form.recurrence}
                  onChange={(e) => setForm({ ...form, recurrence: e.target.value })}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  <option value="none">One-time</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Bi-weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                  <option value="custom">Custom interval...</option>
                </select>
              </div>
            )}

            {(form.trigger_type === "hours" || form.trigger_type === "miles") && (
              <div className="col-span-2 space-y-2">
                <Label>
                  Service every {form.trigger_type === "hours" ? "(operating hours)" : "(miles)"}
                </Label>
                <Input
                  type="number"
                  min={1}
                  value={form.trigger_value || ""}
                  onChange={(e) => setForm({ ...form, trigger_value: parseInt(e.target.value) || 0 })}
                  placeholder={form.trigger_type === "hours" ? "e.g. 100" : "e.g. 5000"}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Service triggers after {form.trigger_value || 0} {form.trigger_type} of accumulated use since the last service.
                  {selectedAsset && selectedAsset.usage_tracking === "none" && (
                    <span className="text-destructive ml-1">
                      ⚠ Selected asset has no usage tracking enabled — enable {form.trigger_type} tracking on the asset for this trigger to fire.
                    </span>
                  )}
                </p>
              </div>
            )}

            {form.trigger_type === "date" && form.recurrence === "custom" && (
              <div className="col-span-2 space-y-2">
                <Label>Repeat every</Label>
                <div className="flex gap-2 items-center">
                  <Input
                    type="number"
                    min={1}
                    value={form.recurrence_interval}
                    onChange={(e) => setForm({ ...form, recurrence_interval: parseInt(e.target.value) || 1 })}
                    className="w-24"
                  />
                  <select
                    value={form.recurrence_unit}
                    onChange={(e) => setForm({ ...form, recurrence_unit: e.target.value })}
                    className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
                  >
                    <option value="days">Day(s)</option>
                    <option value="weeks">Week(s)</option>
                    <option value="months">Month(s)</option>
                    <option value="years">Year(s)</option>
                  </select>
                </div>
              </div>
            )}

            <div className="col-span-2 space-y-2">
              <Label>Scheduled Date *</Label>
              <Input
                type="datetime-local"
                value={form.scheduled_date}
                onChange={(e) => setForm({ ...form, scheduled_date: e.target.value })}
                required
              />
            </div>

            <div className="col-span-2 space-y-2">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
            </div>

            <div className="col-span-2 space-y-2">
              <div className="flex items-center justify-between">
                <Label>Consumables</Label>
                <Button type="button" variant="outline" size="sm" onClick={addConsumable} disabled={consumables.length === 0}>
                  <Plus className="h-3 w-3 mr-1" /> Add
                </Button>
              </div>
              {consumables.length === 0 && (
                <p className="text-xs text-muted-foreground">No consumables defined yet. Add them in the Consumables tab.</p>
              )}
              {form.consumables_used.map((cu: ConsumableUsage, i: number) => (
                <div key={i} className="flex gap-2 items-center">
                  <select
                    value={cu.consumable_id}
                    onChange={(e) => updateConsumable(i, "consumable_id", e.target.value)}
                    className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  >
                    {consumables.map((c) => (
                      <option key={c.id} value={c.id}>{c.name} ({c.quantity_in_stock} {c.unit})</option>
                    ))}
                  </select>
                  <Input
                    type="number"
                    min={1}
                    value={cu.quantity_used}
                    onChange={(e) => updateConsumable(i, "quantity_used", parseInt(e.target.value) || 1)}
                    className="w-20"
                  />
                  <span className="text-xs text-muted-foreground">{cu.unit}</span>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeConsumable(i)}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="col-span-2 space-y-2">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" className="font-semibold">{schedule ? "Save Changes" : "Schedule"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ScheduleDialog;
