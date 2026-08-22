// Parts dependency (bill of materials) editor for one inventory item.
// Example: open it on "Boiler manifold" and list 2 × 1in copper tee,
// 4 × 1in copper elbow — quantities are per ONE parent built.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Loader2, Plus, Trash2 } from "lucide-react";
import {
  addBomComponent,
  getInventoryBom,
  listBomCandidates,
  removeBomComponent,
  updateBomComponent,
} from "@/lib/inventory-bom.functions";
import { formatQty, requirementsFor } from "@/lib/inventory-bom";

const money = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD" });

export function InventoryBomDialog({
  itemId,
  open,
  onOpenChange,
}: {
  itemId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const bomFn = useServerFn(getInventoryBom);
  const candidatesFn = useServerFn(listBomCandidates);
  const addFn = useServerFn(addBomComponent);
  const updateFn = useServerFn(updateBomComponent);
  const removeFn = useServerFn(removeBomComponent);

  const [componentId, setComponentId] = useState("");
  const [qty, setQty] = useState("1");
  const [notes, setNotes] = useState("");
  const [buildUnits, setBuildUnits] = useState("1");

  const enabled = open && Boolean(itemId);
  const bomQuery = useQuery({
    queryKey: ["inventory-bom", itemId],
    queryFn: () => bomFn({ data: { parentItemId: itemId! } }),
    enabled,
  });
  const candidatesQuery = useQuery({
    queryKey: ["inventory-bom-candidates", itemId],
    queryFn: () => candidatesFn({ data: { parentItemId: itemId! } }),
    enabled,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["inventory-bom", itemId] });
  };

  const add = useMutation({
    mutationFn: () =>
      addFn({
        data: {
          parentItemId: itemId!,
          componentItemId: componentId,
          quantity: Number(qty),
          notes: notes.trim() || null,
        },
      }),
    onSuccess: () => {
      setComponentId("");
      setQty("1");
      setNotes("");
      invalidate();
      toast.success("Part added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: (v: { id: string; quantity: number }) => updateFn({ data: v }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => removeFn({ data: { id } }),
    onSuccess: () => {
      invalidate();
      toast.success("Part removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bom = bomQuery.data;
  const requirements = useMemo(
    () => (bom ? requirementsFor(bom.components, Number(buildUnits) || 0) : []),
    [bom, buildUnits],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Parts &amp; dependencies{bom ? ` — ${bom.parent.name}` : ""}
          </DialogTitle>
          <DialogDescription>
            List the inventory parts this item is made from, with the quantity needed to
            build one. Stock and unit costs come from those parts' own records.
          </DialogDescription>
        </DialogHeader>

        {bomQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading parts…</p>
        ) : bomQuery.error ? (
          <p className="text-sm text-red-600">{(bomQuery.error as Error).message}</p>
        ) : bom ? (
          <div className="space-y-5">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Material cost / unit</div>
                <div className="text-lg font-semibold">{money(bom.rollup.materialCost)}</div>
                {bom.rollup.componentsMissingCost > 0 ? (
                  <div className="text-xs text-amber-600">
                    {bom.rollup.componentsMissingCost} part
                    {bom.rollup.componentsMissingCost === 1 ? "" : "s"} missing a unit cost
                  </div>
                ) : null}
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Buildable from stock</div>
                <div className="text-lg font-semibold">{bom.rollup.buildableUnits}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Parts listed</div>
                <div className="text-lg font-semibold">{bom.components.length}</div>
              </div>
            </div>

            {bom.rollup.shortfalls.length > 0 ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm">
                <div className="flex items-center gap-2 font-medium">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  Short on stock to build one
                </div>
                <ul className="mt-1 list-disc pl-5 text-xs">
                  {bom.rollup.shortfalls.map((s) => (
                    <li key={s.name}>
                      {s.name}: need {s.needed}, have {s.onHand} (short {s.short})
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="border rounded-md overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30 text-muted-foreground">
                    <th className="text-left px-3 py-2 font-medium">Part</th>
                    <th className="text-center px-3 py-2 font-medium">Qty / unit</th>
                    <th className="text-center px-3 py-2 font-medium">On hand</th>
                    <th className="text-right px-3 py-2 font-medium">Cost</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {bom.components.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                        No parts listed yet.
                      </td>
                    </tr>
                  ) : (
                    bom.components.map((c) => (
                      <tr key={c.id} className="border-b last:border-0">
                        <td className="px-3 py-2">
                          <div className="font-medium">{c.name}</div>
                          {c.sku ? (
                            <div className="text-xs text-muted-foreground font-mono">{c.sku}</div>
                          ) : null}
                          {c.notes ? (
                            <div className="text-xs text-muted-foreground">{c.notes}</div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Input
                            type="number"
                            min="0"
                            step="any"
                            defaultValue={c.quantity}
                            className="w-24 mx-auto text-center"
                            onBlur={(e) => {
                              const v = Number(e.target.value);
                              if (v > 0 && v !== c.quantity) {
                                update.mutate({ id: c.id, quantity: v });
                              }
                            }}
                          />
                          {c.unit ? (
                            <div className="text-[10px] text-muted-foreground mt-1">{c.unit}</div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className={c.onHand < c.quantity ? "text-amber-600 font-medium" : ""}>
                            {formatQty(c.onHand, c.unit)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {c.unitCost == null ? (
                            <Badge variant="outline">no cost</Badge>
                          ) : (
                            money(c.unitCost * c.quantity)
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => remove.mutate(c.id)}
                            title="Remove part"
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="rounded-md border p-3 space-y-2">
              <div className="text-sm font-medium">Add a part</div>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_100px_auto]">
                <Select value={componentId} onValueChange={setComponentId}>
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        candidatesQuery.isLoading ? "Loading inventory…" : "Choose a part…"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(candidatesQuery.data ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                        {c.sku ? ` · ${c.sku}` : ""} · {c.onHand} on hand
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  placeholder="Qty"
                />
                <Button
                  onClick={() => add.mutate()}
                  disabled={!componentId || !(Number(qty) > 0) || add.isPending}
                >
                  {add.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Plus className="h-4 w-4 mr-1" /> Add
                    </>
                  )}
                </Button>
              </div>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional note — e.g. 'sweat joint, use lead-free solder'"
              />
            </div>

            <div className="rounded-md border p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                Plan a build of
                <Input
                  type="number"
                  min="0"
                  value={buildUnits}
                  onChange={(e) => setBuildUnits(e.target.value)}
                  className="w-20"
                />
                unit(s)
              </div>
              {requirements.length === 0 ? (
                <p className="text-xs text-muted-foreground">Add parts to see requirements.</p>
              ) : (
                <ul className="text-xs space-y-1">
                  {requirements.map((r) => (
                    <li key={r.componentItemId} className="flex justify-between gap-2">
                      <span>{r.name}</span>
                      <span className={r.short > 0 ? "text-amber-600" : "text-muted-foreground"}>
                        need {r.needed} · have {r.onHand}
                        {r.short > 0 ? ` · short ${r.short}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="text-xs text-muted-foreground">
                Estimated material cost:{" "}
                <span className="font-medium">
                  {money(bom.rollup.materialCost * (Number(buildUnits) || 0))}
                </span>
              </div>
            </div>

            {bom.usedIn.length > 0 ? (
              <div className="text-xs text-muted-foreground">
                Used in:{" "}
                {bom.usedIn.map((u) => `${u.name} (×${u.quantity})`).join(", ")}
              </div>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
