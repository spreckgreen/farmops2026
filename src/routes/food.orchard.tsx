import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, TreeDeciduous, Upload, Loader2, Printer } from "lucide-react";
import { openPrintWindow, escapeHtml } from "@/lib/print";
import Papa from "papaparse";
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orchard-trees"] });
      setOpen(false);
      setForm(empty);
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

  function openEdit(t: Tree) {
    setForm({
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
    setOpen(true);
  }

  const bulk = useServerFn(bulkInsertOrchardTrees);
  const importM = useMutation({
    mutationFn: (trees: Array<{
      species: string;
      variety: string | null;
      quantity: number;
      location: string | null;
      planted_on: string | null;
      status: (typeof STATUSES)[number];
      notes: string | null;
    }>) => bulk({ data: { trees } }),
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
        const trees: Array<{
          species: string;
          variety: string | null;
          quantity: number;
          location: string | null;
          planted_on: string | null;
          status: (typeof STATUSES)[number];
          notes: string | null;
        }> = [];
        for (const row of res.data) {
          const species = String(row.species ?? row.Species ?? "").trim();
          if (!species) continue;
          const rawStatus = String(row.status ?? "healthy").trim().toLowerCase();
          const status = (STATUSES as readonly string[]).includes(rawStatus)
            ? (rawStatus as (typeof STATUSES)[number])
            : "healthy";
          const qty = parseInt(String(row.quantity ?? "1"), 10);
          trees.push({
            species,
            variety: String(row.variety ?? "").trim() || null,
            quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
            location: String(row.location ?? "").trim() || null,
            planted_on: String(row.planted_on ?? "").trim() || null,
            status,
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

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : trees.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg p-10 text-center text-sm text-muted-foreground">
          <TreeDeciduous className="h-8 w-8 mx-auto mb-2 opacity-50" />
          No trees logged yet.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(trees as Tree[]).map((t) => (
            <div key={t.id} className="border border-border rounded-lg p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-mono font-semibold">{t.species}</div>
                  {t.variety && <div className="text-xs text-muted-foreground">{t.variety}</div>}
                </div>
                <Badge variant="outline" className={STATUS_COLORS[t.status] ?? ""}>{t.status}</Badge>
              </div>
              <div className="text-xs text-muted-foreground space-y-0.5">
                <div>Qty: {t.quantity}</div>
                {t.location && <div>Location: {t.location}</div>}
                {t.planted_on && <div>Planted: {t.planted_on}</div>}
                {t.notes && <div className="text-foreground/80 mt-1">{t.notes}</div>}
              </div>
              <div className="flex gap-1 pt-1">
                <Button size="sm" variant="ghost" onClick={() => openEdit(t)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteM.mutate(t.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

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
