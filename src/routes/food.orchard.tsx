import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, TreeDeciduous, Loader2, Printer, Check, X } from "lucide-react";
import { openPrintWindow, escapeHtml } from "@/lib/print";
import { CsvToolbar } from "@/components/csv-toolbar";
import {
  listOrchardTrees,
  upsertOrchardTree,
  deleteOrchardTree,
  bulkInsertOrchardTrees,
  getOrchardDashboard,
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

export const Route = createFileRoute("/food/orchard")({
  component: OrchardPage,
});

type Tree = {
  id: string;
  species: string;
  variety: string | null;
  quantity: number;
  location: string | null;
  planted_on: string | null;
  status: string;
  category: string | null;
  notes: string | null;
};

const STATUSES = ["healthy", "young", "producing", "diseased", "removed"] as const;
const CATEGORIES = ["fruit", "nut", "hardwood", "softwood", "other"] as const;
type Category = (typeof CATEGORIES)[number];

const STATUS_COLORS: Record<string, string> = {
  healthy: "bg-emerald-500/20 text-emerald-200 border-emerald-500/40",
  young: "bg-sky-500/20 text-sky-200 border-sky-500/40",
  producing: "bg-amber-500/20 text-amber-200 border-amber-500/40",
  diseased: "bg-orange-500/20 text-orange-200 border-orange-500/40",
  removed: "bg-muted text-muted-foreground border-border",
};

const CATEGORY_COLORS: Record<string, string> = {
  fruit: "bg-rose-500/20 text-rose-200 border-rose-500/40",
  nut: "bg-amber-700/20 text-amber-200 border-amber-700/40",
  hardwood: "bg-stone-500/20 text-stone-200 border-stone-500/40",
  softwood: "bg-teal-500/20 text-teal-200 border-teal-500/40",
  other: "bg-muted text-muted-foreground border-border",
};

const empty = {
  id: null as string | null,
  species: "",
  variety: "",
  quantity: 1,
  location: "",
  planted_on: "",
  status: "healthy" as (typeof STATUSES)[number],
  category: "" as "" | Category,
  notes: "",
};

function OrchardPage() {
  const qc = useQueryClient();
  const list = useServerFn(listOrchardTrees);
  const upsert = useServerFn(upsertOrchardTree);
  const remove = useServerFn(deleteOrchardTree);

  const { data: trees = [], isLoading } = useQuery({
    queryKey: ["orchard-trees"],
    queryFn: () => list(),
  });

  const dashFn = useServerFn(getOrchardDashboard);
  const { data: dash } = useQuery({
    queryKey: ["orchard-dashboard"],
    queryFn: () => dashFn(),
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [categoryFilter, setCategoryFilter] = useState<"all" | Category | "uncategorized">("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState(empty);

  const upsertM = useMutation({
    mutationFn: (vars: typeof empty) =>
      upsert({
        data: {
          id: vars.id,
          species: vars.species,
          variety: vars.variety || null,
          quantity: Number(vars.quantity) || 1,
          location: vars.location || null,
          planted_on: vars.planted_on || null,
          status: vars.status,
          category: vars.category || null,
          notes: vars.notes || null,
        },
      }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["orchard-trees"] });
      if (vars.id && editingId === vars.id) setEditingId(null);
      if (!vars.id) {
        setOpen(false);
        setForm(empty);
      }
      toast.success("Saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orchard-trees"] });
      toast.success("Removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function openNew() {
    setForm(empty);
    setOpen(true);
  }

  function startInlineEdit(t: Tree) {
    setEditingId(t.id);
    setEditDraft({
      id: t.id,
      species: t.species,
      variety: t.variety ?? "",
      quantity: t.quantity,
      location: t.location ?? "",
      planted_on: t.planted_on ?? "",
      status: (STATUSES as readonly string[]).includes(t.status) ? (t.status as (typeof STATUSES)[number]) : "healthy",
      category: (CATEGORIES as readonly string[]).includes(t.category ?? "") ? (t.category as Category) : "",
      notes: t.notes ?? "",
    });
  }
  function cancelInlineEdit() {
    setEditingId(null);
  }
  function saveInlineEdit() {
    if (!editDraft.species.trim()) {
      toast.error("Species is required");
      return;
    }
    upsertM.mutate(editDraft);
  }

  const bulk = useServerFn(bulkInsertOrchardTrees);
  type ImportRow = {
    species: string;
    variety: string | null;
    quantity: number;
    location: string | null;
    planted_on: string | null;
    status: (typeof STATUSES)[number];
    category: Category | null;
    notes: string | null;
  };
  const importM = useMutation({
    mutationFn: (trees: ImportRow[]) => bulk({ data: { trees } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["orchard-trees"] });
      toast.success(`Imported ${r.inserted} trees`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function handleImport(file: File) {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const trees: ImportRow[] = [];
        for (const row of res.data) {
          const species = String(row.species ?? row.Species ?? "").trim();
          if (!species) continue;
          const rawStatus = String(row.status ?? "healthy").trim().toLowerCase();
          const status = (STATUSES as readonly string[]).includes(rawStatus)
            ? (rawStatus as (typeof STATUSES)[number])
            : "healthy";
          const rawCat = String(row.category ?? "").trim().toLowerCase();
          const category = (CATEGORIES as readonly string[]).includes(rawCat)
            ? (rawCat as Category)
            : null;
          const qty = parseInt(String(row.quantity ?? "1"), 10);
          trees.push({
            species,
            variety: String(row.variety ?? "").trim() || null,
            quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
            location: String(row.location ?? "").trim() || null,
            planted_on: String(row.planted_on ?? "").trim() || null,
            status,
            category,
            notes: String(row.notes ?? "").trim() || null,
          });
        }
        if (!trees.length) {
          toast.error("No valid rows. Required column: species");
          return;
        }
        importM.mutate(trees);
      },
      error: (err) => toast.error(`Parse error: ${err.message}`),
    });
  }

  function printOrchard() {
    const list = trees as Tree[];
    const totalTrees = list.reduce((s, t) => s + (t.quantity || 0), 0);
    const rows = list
      .map(
        (t) => `<tr>
          <td>${escapeHtml(t.species)}</td>
          <td>${escapeHtml(t.variety)}</td>
          <td style="text-align:right">${t.quantity}</td>
          <td>${escapeHtml(t.location)}</td>
          <td>${escapeHtml(t.planted_on)}</td>
          <td><span class="badge">${escapeHtml(t.status)}</span></td>
          <td>${escapeHtml(t.notes)}</td>
        </tr>`,
      )
      .join("");
    const body = list.length
      ? `<table>
          <thead><tr><th>Species</th><th>Variety</th><th>Qty</th><th>Location</th><th>Planted</th><th>Status</th><th>Notes</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
      : `<div class="empty-note">No trees logged.</div>`;
    openPrintWindow(
      "Orchard",
      `<header><h1>Orchard</h1><div class="meta">${list.length} entries · ${totalTrees} trees · printed ${new Date().toLocaleDateString()}</div></header>
       ${body}`,
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-mono font-semibold">Orchard</h2>
          <p className="text-sm text-muted-foreground">Track fruit and nut trees on the property.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={printOrchard} disabled={isLoading}>
            <Printer className="h-4 w-4 mr-2" /> Print
          </Button>
          <Label htmlFor="orchard-csv" className="cursor-pointer">
            <span className="inline-flex items-center gap-2 border border-border rounded-md px-3 py-2 text-sm hover:bg-muted">
              {importM.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Import CSV
            </span>
            <input
              id="orchard-csv"
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImport(f);
                e.currentTarget.value = "";
              }}
            />
          </Label>
          <Button onClick={openNew}>
            <Plus className="h-4 w-4 mr-2" /> Add tree
          </Button>
        </div>
      </div>

      <YieldDashboard
        data={dash}
        labels={{
          unit: "tree",
          unitPlural: "trees",
          perUnitLabel: "lbs/tree",
          needUnitsLabel: "Need trees",
          totalUnitsCardLabel: "Total trees",
          yieldPanelTitle: "Trees · estimated seasonal yield",
        }}
      />

      {(() => {
        const all = trees as Tree[];
        const counts = CATEGORIES.reduce<Record<string, number>>((acc, c) => {
          acc[c] = all.filter((t) => t.category === c).reduce((s, t) => s + (t.quantity || 0), 0);
          return acc;
        }, {});
        const uncategorized = all.filter((t) => !t.category).reduce((s, t) => s + (t.quantity || 0), 0);
        const filtered = categoryFilter === "all"
          ? all
          : categoryFilter === "uncategorized"
            ? all.filter((t) => !t.category)
            : all.filter((t) => t.category === categoryFilter);
        return (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setCategoryFilter("all")}
                className={`text-xs px-2.5 py-1 rounded-md border ${categoryFilter === "all" ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:bg-muted"}`}
              >
                All · {all.reduce((s, t) => s + (t.quantity || 0), 0)}
              </button>
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategoryFilter(c)}
                  className={`text-xs px-2.5 py-1 rounded-md border capitalize ${categoryFilter === c ? "bg-foreground text-background border-foreground" : `${CATEGORY_COLORS[c]} hover:opacity-80`}`}
                >
                  {c} · {counts[c] ?? 0}
                </button>
              ))}
              {uncategorized > 0 && (
                <button
                  onClick={() => setCategoryFilter("uncategorized")}
                  className={`text-xs px-2.5 py-1 rounded-md border ${categoryFilter === "uncategorized" ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:bg-muted"}`}
                >
                  Uncategorized · {uncategorized}
                </button>
              )}
            </div>

            {isLoading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="border border-dashed border-border rounded-lg p-10 text-center text-sm text-muted-foreground">
                <TreeDeciduous className="h-8 w-8 mx-auto mb-2 opacity-50" />
                {all.length === 0 ? "No trees logged yet." : "No trees in this category."}
              </div>
            ) : (
              (() => {
                const groupOrder: Array<Category | "uncategorized"> = [
                  ...CATEGORIES,
                  "uncategorized",
                ];
                const groups = groupOrder
                  .map((g) => ({
                    key: g,
                    items: filtered.filter((t) =>
                      g === "uncategorized" ? !t.category : t.category === g,
                    ),
                  }))
                  .filter((g) => g.items.length > 0);
                return (
                  <div className="space-y-6">
                    {groups.map((g) => {
                      const qty = g.items.reduce((s, t) => s + (t.quantity || 0), 0);
                      const swatch =
                        g.key === "uncategorized"
                          ? "border-border text-muted-foreground"
                          : CATEGORY_COLORS[g.key];
                      return (
                        <section key={g.key} className="space-y-3">
                          <div className="flex items-center gap-2 border-b border-border pb-2">
                            <span className={`inline-block w-2 h-2 rounded-full ${swatch?.split(" ")[0] ?? "bg-muted"}`} />
                            <h3 className="text-sm font-mono font-semibold capitalize">{g.key}</h3>
                            <span className="text-xs text-muted-foreground">
                              {g.items.length} {g.items.length === 1 ? "entry" : "entries"} · {qty} {qty === 1 ? "tree" : "trees"}
                            </span>
                          </div>
                          <div className="border border-border rounded-md overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                                <tr>
                                  <th className="text-left font-medium px-3 py-2">Species</th>
                                  <th className="text-left font-medium px-3 py-2">Variety</th>
                                  <th className="text-right font-medium px-3 py-2">Qty</th>
                                  <th className="text-left font-medium px-3 py-2">Location</th>
                                  <th className="text-left font-medium px-3 py-2">Planted</th>
                                  <th className="text-left font-medium px-3 py-2">Status</th>
                                  <th className="text-left font-medium px-3 py-2">Notes</th>
                                  <th className="w-20 px-3 py-2"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {g.items.map((t) => {
                                  const isEditing = editingId === t.id;
                                  if (!isEditing) {
                                    return (
                                      <tr key={t.id} className="border-t border-border hover:bg-muted/30">
                                        <td className="px-3 py-2 font-mono">{t.species}</td>
                                        <td className="px-3 py-2 text-muted-foreground">{t.variety ?? ""}</td>
                                        <td className="px-3 py-2 text-right tabular-nums">{t.quantity}</td>
                                        <td className="px-3 py-2 text-muted-foreground">{t.location ?? ""}</td>
                                        <td className="px-3 py-2 text-muted-foreground">{t.planted_on ?? ""}</td>
                                        <td className="px-3 py-2">
                                          <Badge variant="outline" className={STATUS_COLORS[t.status] ?? ""}>{t.status}</Badge>
                                        </td>
                                        <td className="px-3 py-2 text-muted-foreground max-w-xs truncate" title={t.notes ?? ""}>{t.notes ?? ""}</td>
                                        <td className="px-3 py-2">
                                          <div className="flex justify-end gap-1">
                                            <Button size="sm" variant="ghost" onClick={() => startInlineEdit(t)} title="Edit">
                                              <Pencil className="h-3.5 w-3.5" />
                                            </Button>
                                            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteM.mutate(t.id)} title="Delete">
                                              <Trash2 className="h-3.5 w-3.5" />
                                            </Button>
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  }
                                  return (
                                    <tr key={t.id} className="border-t border-border bg-muted/20 align-top">
                                      <td className="px-2 py-2">
                                        <Input className="h-8" value={editDraft.species} onChange={(e) => setEditDraft({ ...editDraft, species: e.target.value })} />
                                      </td>
                                      <td className="px-2 py-2">
                                        <Input className="h-8" value={editDraft.variety} onChange={(e) => setEditDraft({ ...editDraft, variety: e.target.value })} />
                                      </td>
                                      <td className="px-2 py-2">
                                        <Input type="number" min={1} className="h-8 w-20 text-right" value={editDraft.quantity} onChange={(e) => setEditDraft({ ...editDraft, quantity: parseInt(e.target.value) || 1 })} />
                                      </td>
                                      <td className="px-2 py-2">
                                        <Input className="h-8" value={editDraft.location} onChange={(e) => setEditDraft({ ...editDraft, location: e.target.value })} />
                                      </td>
                                      <td className="px-2 py-2">
                                        <Input type="date" className="h-8" value={editDraft.planted_on} onChange={(e) => setEditDraft({ ...editDraft, planted_on: e.target.value })} />
                                      </td>
                                      <td className="px-2 py-2">
                                        <Select value={editDraft.status} onValueChange={(v) => setEditDraft({ ...editDraft, status: v as (typeof STATUSES)[number] })}>
                                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                                          <SelectContent>
                                            {STATUSES.map((s) => (
                                              <SelectItem key={s} value={s}>{s}</SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                        <Select
                                          value={editDraft.category || "none"}
                                          onValueChange={(v) => setEditDraft({ ...editDraft, category: v === "none" ? "" : (v as Category) })}
                                        >
                                          <SelectTrigger className="h-8 mt-1"><SelectValue /></SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="none">— Unset —</SelectItem>
                                            {CATEGORIES.map((c) => (
                                              <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                      </td>
                                      <td className="px-2 py-2">
                                        <Textarea
                                          className="min-h-[2rem] h-16"
                                          value={editDraft.notes}
                                          onChange={(e) => setEditDraft({ ...editDraft, notes: e.target.value })}
                                        />
                                      </td>
                                      <td className="px-2 py-2">
                                        <div className="flex justify-end gap-1">
                                          <Button size="sm" variant="ghost" className="text-emerald-400" onClick={saveInlineEdit} disabled={upsertM.isPending} title="Save">
                                            {upsertM.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                          </Button>
                                          <Button size="sm" variant="ghost" onClick={cancelInlineEdit} title="Cancel">
                                            <X className="h-3.5 w-3.5" />
                                          </Button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </section>
                      );
                    })}
                  </div>
                );
              })()
            )}
          </>
        );
      })()}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit tree" : "Add tree"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Species *</Label>
                <Input value={form.species} onChange={(e) => setForm({ ...form, species: e.target.value })} placeholder="Apple" />
              </div>
              <div>
                <Label>Variety</Label>
                <Input value={form.variety} onChange={(e) => setForm({ ...form, variety: e.target.value })} placeholder="Honeycrisp" />
              </div>
              <div>
                <Label>Quantity</Label>
                <Input type="number" min={1} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: parseInt(e.target.value) || 1 })} />
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as (typeof STATUSES)[number] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Location</Label>
                <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="North field" />
              </div>
              <div>
                <Label>Planted on</Label>
                <Input type="date" value={form.planted_on} onChange={(e) => setForm({ ...form, planted_on: e.target.value })} />
              </div>
              <div>
                <Label>Category</Label>
                <Select
                  value={form.category || "none"}
                  onValueChange={(v) => setForm({ ...form, category: v === "none" ? "" : (v as Category) })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Unset —</SelectItem>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => upsertM.mutate(form)} disabled={upsertM.isPending || !form.species.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
