import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { X, ScanLine, CheckCircle2, AlertTriangle } from "lucide-react";
import BarcodeScanner from "./BarcodeScanner";
import type { Asset, AssetFormData } from "./types";
import { INVENTORY_TYPES } from "@/lib/obsidian-layout";

/** Catalog value for the "32 Kits" inventory type (seeded in every environment). */
const KIT_TYPE = "32_kits";

/**
 * Shows what is actually stored in the database for this item's type, so a kit
 * can be verified at a glance: saved value, catalog label, whether the picker
 * still matches the saved row, and a one-click fix for kit-named items that
 * were never classified as 32 Kits.
 */
function SavedTypeCheck({
  savedType,
  selectedType,
  name,
  onUseKitType,
}: {
  savedType: string | null;
  selectedType: string;
  name: string;
  onUseKitType: () => void;
}) {
  const saved = INVENTORY_TYPES.find((t) => t.value === savedType);
  const unsaved = (selectedType || "") !== (savedType || "");
  const looksLikeKit = /\bkits?\b/i.test(name || "");
  const isKit = savedType === KIT_TYPE;

  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-2 space-y-1 text-[11px]">
      <div className="flex items-center gap-1.5">
        {isKit ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
        ) : savedType ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
        )}
        <span>
          Saved in database:{" "}
          <span className="font-medium">
            {savedType ? `${saved?.label ?? "unknown type"} (${savedType})` : "no type set"}
          </span>
        </span>
      </div>
      {savedType && !saved ? (
        <div className="text-amber-500">
          This value is not in the type catalog — pick a listed type and save.
        </div>
      ) : null}
      {unsaved ? (
        <div className="text-amber-500">
          Unsaved change — the picker shows{" "}
          {selectedType
            ? `${INVENTORY_TYPES.find((t) => t.value === selectedType)?.label ?? selectedType}`
            : "Unclassified"}
          . Press Save Changes to write it.
        </div>
      ) : null}
      {looksLikeKit && !isKit ? (
        <div className="flex items-center gap-2 pt-1">
          <span className="text-amber-500">This looks like a kit but is not 32 Kits.</span>
          <Button type="button" size="sm" variant="outline" className="h-6 px-2" onClick={onUseKitType}>
            Use 32 Kits
          </Button>
        </div>
      ) : null}
    </div>
  );
}

interface AssetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: AssetFormData) => void;
  asset: Asset | null;
}


const emptyForm: AssetFormData = {
  name: "",
  description: "",
  location: "",
  quantity: 1,
  min_quantity: 0,
  status: "available",
  tags: [],
  barcode: "",
  current_hours: 0,
  current_miles: 0,
  usage_tracking: "none",
  item_type: "",
};


const AssetDialog = ({ open, onOpenChange, onSave, asset }: AssetDialogProps) => {
  const [form, setForm] = useState<AssetFormData>(emptyForm);
  const [tagInput, setTagInput] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);

  useEffect(() => {
    if (asset) {
      setForm({
        name: asset.name ?? "",
        description: asset.description ?? "",
        location: asset.location ?? "",

        quantity: Number(asset.quantity ?? 0),
        min_quantity: Number(asset.min_quantity ?? 0),
        status: asset.status ?? "available",
        tags: asset.tags || [],
        barcode: asset.barcode ?? "",
        current_hours: Number(asset.current_hours ?? 0),
        current_miles: Number(asset.current_miles ?? 0),
        usage_tracking: asset.usage_tracking ?? "none",
        item_type: asset.item_type ?? "",
      });
    } else {
      setForm(emptyForm);
    }
    setTagInput("");
  }, [asset, open]);

  const addTag = () => {
    const tag = tagInput.trim();
    if (tag && !form.tags.includes(tag)) {
      setForm({ ...form, tags: [...form.tags, tag] });
    }
    setTagInput("");
  };

  const removeTag = (tag: string) => {
    setForm({ ...form, tags: form.tags.filter((t) => t !== tag) });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-card border-border">
        <DialogHeader>
          <DialogTitle className="font-heading">
            {asset ? "Edit Asset" : "Add Asset"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-2">
              <Label>Name *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label>Location</Label>
              <Input
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="e.g. Warehouse A"
              />
            </div>
            <div className="space-y-2">
              <Label>Quantity</Label>
              <Input
                type="number"
                min={0}
                value={form.quantity}
                onChange={(e) =>
                  setForm({ ...form, quantity: parseInt(e.target.value) || 0 })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Min Quantity (alert)</Label>
              <Input
                type="number"
                min={0}
                value={form.min_quantity}
                onChange={(e) =>
                  setForm({ ...form, min_quantity: parseInt(e.target.value) || 0 })
                }
              />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Inventory Type</Label>
              <select
                value={form.item_type}
                onChange={(e) => setForm({ ...form, item_type: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="">— Unclassified —</option>
                <optgroup label="Kits & assemblies">
                  {INVENTORY_TYPES.filter((t) => t.value === KIT_TYPE).map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="All inventory types">
                  {INVENTORY_TYPES.filter((t) => t.value !== KIT_TYPE).map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </optgroup>
              </select>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-muted-foreground">
                  Controls the Obsidian vault subfolder this item syncs into.
                </p>
                {form.item_type !== KIT_TYPE ? (
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, item_type: KIT_TYPE })}
                    className="shrink-0 text-[11px] font-medium text-primary underline-offset-2 hover:underline"
                  >
                    Use 32 Kits
                  </button>
                ) : (
                  <span className="shrink-0 text-[11px] font-medium text-emerald-500">
                    Saved as a kit — a Parts (BOM) panel appears after saving.
                  </span>
                )}
              </div>
              {asset ? (
                <SavedTypeCheck
                  savedType={asset.item_type ?? null}
                  selectedType={form.item_type}
                  name={form.name}
                  onUseKitType={() => setForm({ ...form, item_type: KIT_TYPE })}
                />
              ) : null}
            </div>


            <div className="col-span-2 space-y-2">
              <Label>Status</Label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="available">Available</option>
                <option value="in_use">In Use</option>
                <option value="maintenance">Maintenance</option>
                <option value="retired">Retired</option>
              </select>
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Usage Tracking</Label>
              <select
                value={form.usage_tracking}
                onChange={(e) => setForm({ ...form, usage_tracking: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="none">None</option>
                <option value="hours">Hours</option>
                <option value="miles">Miles</option>
                <option value="both">Hours & Miles</option>
              </select>
            </div>
            {(form.usage_tracking === "hours" || form.usage_tracking === "both") && (
              <div className="space-y-2">
                <Label>Current Hours</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.1"
                  value={form.current_hours}
                  onChange={(e) =>
                    setForm({ ...form, current_hours: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
            )}
            {(form.usage_tracking === "miles" || form.usage_tracking === "both") && (
              <div className="space-y-2">
                <Label>Current Miles</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.1"
                  value={form.current_miles}
                  onChange={(e) =>
                    setForm({ ...form, current_miles: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
            )}
            <div className="col-span-2 space-y-2">
              <Label>Barcode</Label>
              <div className="flex gap-2">
                <Input
                  value={form.barcode}
                  onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                  placeholder="Scan or type barcode"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setScannerOpen(true)}
                >
                  <ScanLine className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Tags</Label>
              <div className="flex gap-2">
                <Input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  placeholder="Add a tag"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                />
                <Button type="button" variant="outline" size="sm" onClick={addTag}>
                  Add
                </Button>
              </div>
              {form.tags.length > 0 && (
                <div className="flex gap-1 flex-wrap mt-2">
                  {form.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium"
                    >
                      {tag}
                      <button type="button" onClick={() => removeTag(tag)}>
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" className="font-semibold">
              {asset ? "Save Changes" : "Add Asset"}
            </Button>
          </div>
        </form>
        <BarcodeScanner
          open={scannerOpen}
          onOpenChange={setScannerOpen}
          onScan={(code) => setForm({ ...form, barcode: code })}
        />
      </DialogContent>
    </Dialog>
  );
};

export default AssetDialog;
