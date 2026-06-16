import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Consumable, ConsumableFormData } from "@/types/scheduling";

interface ConsumableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: ConsumableFormData) => void;
  consumable: Consumable | null;
}

const emptyForm: ConsumableFormData = {
  name: "",
  unit: "pcs",
  quantity_in_stock: 0,
  min_quantity: 0,
  cost_per_unit: 0,
  category: "",
};

const ConsumableDialog = ({ open, onOpenChange, onSave, consumable }: ConsumableDialogProps) => {
  const [form, setForm] = useState<ConsumableFormData>(emptyForm);

  useEffect(() => {
    if (consumable) {
      setForm({
        name: consumable.name,
        unit: consumable.unit || "pcs",
        quantity_in_stock: consumable.quantity_in_stock,
        min_quantity: consumable.min_quantity,
        cost_per_unit: consumable.cost_per_unit || 0,
        category: consumable.category || "",
      });
    } else {
      setForm(emptyForm);
    }
  }, [consumable, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="font-heading">{consumable ? "Edit Consumable" : "Add Consumable"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-2">
              <Label>Name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label>Unit</Label>
              <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="pcs, liters, kg" />
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>In Stock</Label>
              <Input type="number" min={0} value={form.quantity_in_stock} onChange={(e) => setForm({ ...form, quantity_in_stock: parseInt(e.target.value) || 0 })} />
            </div>
            <div className="space-y-2">
              <Label>Min Quantity</Label>
              <Input type="number" min={0} value={form.min_quantity} onChange={(e) => setForm({ ...form, min_quantity: parseInt(e.target.value) || 0 })} />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Cost per Unit</Label>
              <Input type="number" min={0} step="0.01" value={form.cost_per_unit} onChange={(e) => setForm({ ...form, cost_per_unit: parseFloat(e.target.value) || 0 })} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" className="font-semibold">{consumable ? "Save Changes" : "Add"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ConsumableDialog;
