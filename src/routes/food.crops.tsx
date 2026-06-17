import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Plus, Pencil, Trash2, Sprout } from "lucide-react";
import {
  addCropHarvest,
  deleteCropHarvest,
  deleteCropPlanting,
  listCropPlantings,
  upsertCropPlanting,
  getCropsDashboard,
} from "@/lib/food.functions";
import { YieldDashboard } from "@/components/yield-dashboard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/food/crops")({
  component: CropsPage,
});

type Planting = {
  id: string;
  crop: string;
  variety: string | null;
  area: string | null;
  planted_on: string | null;
  expected_harvest: string | null;
  status: string;
  notes: string | null;
  crop_harvests:
    | Array<{
        id: string;
        harvested_on: string;
        quantity: number;
        unit: string;
        quality: string | null;
        notes: string | null;
      }>
    | null;
};

const STATUSES = ["planned", "growing", "harvested", "ended"] as const;
const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  planned: "outline",
  growing: "default",
  harvested: "secondary",
  ended: "outline",
};

function CropsPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listCropPlantings);
  const saveFn = useServerFn(upsertCropPlanting);
  const delFn = useServerFn(deleteCropPlanting);
  const addHarvestFn = useServerFn(addCropHarvest);
  const delHarvestFn = useServerFn(deleteCropHarvest);

  const q = useQuery({ queryKey: ["food", "crops"], queryFn: () => listFn() });

  const dashFn = useServerFn(getCropsDashboard);
  const { data: dash } = useQuery({
    queryKey: ["food", "crops-dashboard"],
    queryFn: () => dashFn(),
  });

  const [editing, setEditing] = useState<Partial<Planting> | null>(null);
  const [harvestFor, setHarvestFor] = useState<Planting | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["food", "crops"] });
    qc.invalidateQueries({ queryKey: ["food", "overview"] });
  };

  const save = useMutation({
    mutationFn: (p: Partial<Planting>) =>
      saveFn({
        data: {
          id: p.id ?? null,
          crop: p.crop ?? "",
          variety: p.variety ?? null,
          area: p.area ?? null,
          planted_on: p.planted_on ?? null,
          expected_harvest: p.expected_harvest ?? null,
          status: (p.status as (typeof STATUSES)[number]) ?? "planned",
          notes: p.notes ?? "",
        },
      }),
    onSuccess: () => {
      toast.success("Planting saved");
      setEditing(null);
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Planting deleted");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const addHarvest = useMutation({
    mutationFn: (input: {
      planting_id: string;
      harvested_on: string;
      quantity: string;
      unit: string;
      quality: string;
      notes: string;
    }) => addHarvestFn({ data: input }),
    onSuccess: () => {
      toast.success("Harvest logged");
      setHarvestFor(null);
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const removeHarvest = useMutation({
    mutationFn: (id: string) => delHarvestFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Harvest deleted");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const plantings = (q.data ?? []) as Planting[];

      <YieldDashboard
        data={dash}
        labels={{
          unit: "planting",
          unitPlural: "plantings",
          perUnitLabel: "lbs/planting",
          needUnitsLabel: "Need plantings",
          totalUnitsCardLabel: "Total plantings",
          yieldPanelTitle: "Crops · harvested vs. plan",
        }}
      />


  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Plantings &amp; harvests. Click a row to log a harvest.
        </p>
        <Button size="sm" onClick={() => setEditing({ status: "planned" })}>
          <Plus className="h-4 w-4 mr-1.5" /> New planting
        </Button>
      </div>

      {q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!q.isLoading && plantings.length === 0 && (
        <div className="border border-dashed border-border rounded-md p-8 text-center text-sm text-muted-foreground">
          <Sprout className="h-6 w-6 mx-auto mb-2 opacity-60" />
          No plantings yet.
        </div>
      )}

      <ul className="space-y-2">
        {plantings.map((p) => {
          const totalHarvest = (p.crop_harvests ?? []).reduce(
            (acc, h) => acc + Number(h.quantity ?? 0),
            0,
          );
          const harvestUnit = p.crop_harvests?.[0]?.unit ?? "";
          return (
            <li key={p.id} className="border border-border rounded-md bg-card p-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-mono font-semibold truncate">{p.crop}</h3>
                    {p.variety && (
                      <span className="text-xs text-muted-foreground">· {p.variety}</span>
                    )}
                    <Badge variant={STATUS_VARIANT[p.status] ?? "outline"} className="text-[10px]">
                      {p.status}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 space-x-3 font-mono">
                    {p.area && <span>{p.area}</span>}
                    {p.planted_on && (
                      <span>planted {format(new Date(p.planted_on), "MMM d, yyyy")}</span>
                    )}
                    {p.expected_harvest && (
                      <span>
                        eta {format(new Date(p.expected_harvest), "MMM d")}
                      </span>
                    )}
                    {(p.crop_harvests?.length ?? 0) > 0 && (
                      <span>
                        harvested {totalHarvest} {harvestUnit}
                      </span>
                    )}
                  </div>
                  {p.notes && <p className="text-sm mt-2 whitespace-pre-line">{p.notes}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant="outline" onClick={() => setHarvestFor(p)}>
                    Log harvest
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (confirm(`Delete planting "${p.crop}"?`)) remove.mutate(p.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {(p.crop_harvests?.length ?? 0) > 0 && (
                <ul className="mt-3 border-t border-border pt-2 space-y-1">
                  {p.crop_harvests!.map((h) => (
                    <li
                      key={h.id}
                      className="flex items-center justify-between text-xs font-mono"
                    >
                      <span>
                        {format(new Date(h.harvested_on), "MMM d, yyyy")} ·{" "}
                        {h.quantity} {h.unit}
                        {h.quality && ` · ${h.quality}`}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0"
                        onClick={() => {
                          if (confirm("Delete this harvest?")) removeHarvest.mutate(h.id);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      <PlantingDialog
        value={editing}
        onClose={() => setEditing(null)}
        onSave={(v) => save.mutate(v)}
        saving={save.isPending}
      />
      <HarvestDialog
        planting={harvestFor}
        onClose={() => setHarvestFor(null)}
        onSave={(v) => addHarvest.mutate(v)}
        saving={addHarvest.isPending}
      />
    </div>
  );
}

function PlantingDialog({
  value,
  onClose,
  onSave,
  saving,
}: {
  value: Partial<Planting> | null;
  onClose: () => void;
  onSave: (v: Partial<Planting>) => void;
  saving: boolean;
}) {
  const open = value !== null;
  const v = value ?? {};
  const [form, setForm] = useState<Partial<Planting>>({});
  const current = open ? { ...v, ...form } : {};

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setForm({});
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{v.id ? "Edit planting" : "New planting"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Crop">
            <Input
              value={current.crop ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, crop: e.target.value }))}
              placeholder="Tomato, Corn, Carrots…"
              autoFocus
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Variety">
              <Input
                value={current.variety ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, variety: e.target.value }))}
              />
            </Field>
            <Field label="Area / bed">
              <Input
                value={current.area ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Planted on">
              <Input
                type="date"
                value={current.planted_on ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, planted_on: e.target.value }))}
              />
            </Field>
            <Field label="Expected harvest">
              <Input
                type="date"
                value={current.expected_harvest ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, expected_harvest: e.target.value }))}
              />
            </Field>
          </div>
          <Field label="Status">
            <Select
              value={current.status ?? "planned"}
              onValueChange={(val) => setForm((f) => ({ ...f, status: val }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Notes">
            <Textarea
              rows={3}
              value={current.notes ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={saving || !(current.crop ?? "").trim()}
            onClick={() => onSave(current)}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HarvestDialog({
  planting,
  onClose,
  onSave,
  saving,
}: {
  planting: Planting | null;
  onClose: () => void;
  onSave: (v: {
    planting_id: string;
    harvested_on: string;
    quantity: string;
    unit: string;
    quality: string;
    notes: string;
  }) => void;
  saving: boolean;
}) {
  const open = planting !== null;
  const [form, setForm] = useState<{
    harvested_on: string;
    quantity: string;
    unit: string;
    quality: string;
    notes: string;
  }>({
    harvested_on: new Date().toISOString().slice(0, 10),
    quantity: "",
    unit: "lbs",
    quality: "",
    notes: "",
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setForm({
            harvested_on: new Date().toISOString().slice(0, 10),
            quantity: "",
            unit: "lbs",
            quality: "",
            notes: "",
          });
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log harvest{planting ? ` · ${planting.crop}` : ""}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <Input
                type="date"
                value={form.harvested_on}
                onChange={(e) => setForm((f) => ({ ...f, harvested_on: e.target.value }))}
              />
            </Field>
            <Field label="Quality">
              <Input
                value={form.quality}
                onChange={(e) => setForm((f) => ({ ...f, quality: e.target.value }))}
                placeholder="A, B, seconds…"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity">
              <Input
                inputMode="decimal"
                value={form.quantity}
                onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
              />
            </Field>
            <Field label="Unit">
              <Input
                value={form.unit}
                onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                placeholder="lbs, bushels, ea"
              />
            </Field>
          </div>
          <Field label="Notes">
            <Textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={saving || !form.quantity.trim() || !planting}
            onClick={() =>
              planting &&
              onSave({
                planting_id: planting.id,
                harvested_on: form.harvested_on,
                quantity: form.quantity,
                unit: form.unit.trim() || "lbs",
                quality: form.quality,
                notes: form.notes,
              })
            }
          >
            {saving ? "Saving…" : "Log harvest"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
