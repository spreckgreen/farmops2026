import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { createInventory } from "@/lib/inventory.functions";
import { createMaintenance } from "@/lib/maintenance.functions";

type FieldDef = {
  name: string;
  label: string;
  type?: "text" | "number" | "date" | "textarea";
  required?: boolean;
  placeholder?: string;
  colSpan?: 1 | 2;
};

function FormFields({
  fields,
  values,
  setValues,
}: {
  fields: FieldDef[];
  values: Record<string, string>;
  setValues: (v: Record<string, string>) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {fields.map((f) => (
        <div key={f.name} className={f.colSpan === 2 ? "col-span-2" : "col-span-2 sm:col-span-1"}>
          <Label htmlFor={f.name} className="text-xs text-muted-foreground">
            {f.label}
            {f.required && <span className="text-destructive ml-0.5">*</span>}
          </Label>
          {f.type === "textarea" ? (
            <Textarea
              id={f.name}
              value={values[f.name] ?? ""}
              onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
              placeholder={f.placeholder}
              className="mt-1 bg-card/60 border-border"
              rows={3}
            />
          ) : (
            <Input
              id={f.name}
              type={f.type ?? "text"}
              value={values[f.name] ?? ""}
              onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
              placeholder={f.placeholder}
              className="mt-1 bg-card/60 border-border"
            />
          )}
        </div>
      ))}
    </div>
  );
}

const INVENTORY_FIELDS: FieldDef[] = [
  { name: "name", label: "Name", required: true, placeholder: "e.g. Hydraulic Fluid" },
  { name: "sku", label: "SKU / Code", placeholder: "HF-001" },
  { name: "category", label: "Category", placeholder: "Fluids" },
  { name: "location", label: "Location", placeholder: "Shop A" },
  { name: "quantity", label: "Quantity", type: "number", placeholder: "0" },
  { name: "unit", label: "Unit", placeholder: "gal, ea, lb" },
  { name: "reorder_level", label: "Reorder level", type: "number", placeholder: "0" },
  { name: "unit_cost", label: "Unit cost", type: "number", placeholder: "0.00" },
  { name: "vendor", label: "Vendor", placeholder: "Supplier name" },
  { name: "notes", label: "Notes", type: "textarea", colSpan: 2 },
];

const MAINTENANCE_FIELDS: FieldDef[] = [
  { name: "asset_name", label: "Asset", required: true, placeholder: "e.g. Tractor #3" },
  { name: "title", label: "Title", placeholder: "Oil change" },
  { name: "service_type", label: "Service type", placeholder: "Routine / Repair" },
  { name: "status", label: "Status", placeholder: "scheduled / done" },
  { name: "scheduled_date", label: "Scheduled date", type: "date" },
  { name: "performed_at", label: "Performed on", type: "date" },
  { name: "due_at", label: "Next due", type: "date" },
  { name: "cost", label: "Cost", type: "number", placeholder: "0.00" },
  { name: "vendor", label: "Vendor / Technician", placeholder: "" },
  { name: "notes", label: "Notes", type: "textarea", colSpan: 2 },
];

export function NewRecordDialog({
  kind,
  trigger,
}: {
  kind: "inventory" | "maintenance";
  trigger: ReactNode;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});

  const createInv = useServerFn(createInventory);
  const createMnt = useServerFn(createMaintenance);

  const isInv = kind === "inventory";
  const fields = isInv ? INVENTORY_FIELDS : MAINTENANCE_FIELDS;
  const queryKey = isInv ? ["inventory"] : ["maintenance"];

  const mut = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {};
      for (const f of fields) {
        const v = (values[f.name] ?? "").trim();
        if (v === "") continue;
        payload[f.name] = v;
      }
      if (isInv) {
        if (!payload.name) throw new Error("Name is required");
        return createInv({ data: payload as never });
      }
      if (!payload.asset_name) throw new Error("Asset is required");
      return createMnt({ data: payload as never });
    },
    onSuccess: () => {
      toast.success(isInv ? "Item added" : "Record added");
      setValues({});
      setOpen(false);
      qc.invalidateQueries({ queryKey });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="bg-card border-border max-w-xl">
        <DialogHeader>
          <DialogTitle>{isInv ? "New inventory item" : "New maintenance record"}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {isInv
              ? "Add a single item to your inventory."
              : "Log a service or schedule upcoming work."}
          </DialogDescription>
        </DialogHeader>
        <FormFields fields={fields} values={values} setValues={setValues} />
        <DialogFooter className="mt-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={mut.isPending}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-glow"
          >
            {mut.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
