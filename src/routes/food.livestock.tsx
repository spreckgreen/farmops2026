import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Beef, Upload, Loader2, Printer, Download } from "lucide-react";
import Papa from "papaparse";
import { openPrintWindow, escapeHtml } from "@/lib/print";
import {
  listLivestock,
  upsertLivestock,
  deleteLivestock,
  bulkInsertLivestock,
  getLivestockDashboard,
} from "@/lib/food.functions";
import { YieldDashboard } from "@/components/yield-dashboard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/food/livestock")({
  component: LivestockPage,
});

type Animal = {
  id: string;
  species: string;
  breed: string | null;
  tag: string | null;
  sex: string | null;
  birth_date: string | null;
  quantity: number;
  purpose: string;
  expected_yield_lbs: number | null;
  yield_unit: string;
  status: string;
  location: string | null;
  notes: string | null;
};

const PURPOSES = ["meat", "dairy", "eggs", "fiber", "breeding", "other"] as const;
const STATUSES = ["active", "sold", "processed", "deceased"] as const;
const YIELD_UNITS = ["lbs", "gal_milk", "dozen_eggs", "eggs", "other"] as const;

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-500/20 text-emerald-200 border-emerald-500/40",
  sold: "bg-sky-500/20 text-sky-200 border-sky-500/40",
  processed: "bg-amber-500/20 text-amber-200 border-amber-500/40",
  deceased: "bg-muted text-muted-foreground border-border",
};

const PURPOSE_COLORS: Record<string, string> = {
  meat: "bg-rose-500/20 text-rose-200 border-rose-500/40",
  dairy: "bg-blue-500/20 text-blue-200 border-blue-500/40",
  eggs: "bg-yellow-500/20 text-yellow-200 border-yellow-500/40",
  fiber: "bg-violet-500/20 text-violet-200 border-violet-500/40",
  breeding: "bg-pink-500/20 text-pink-200 border-pink-500/40",
  other: "bg-muted text-muted-foreground border-border",
};

const empty = {
  id: null as string | null,
  species: "",
  breed: "",
  tag: "",
  sex: "",
  birth_date: "",
  quantity: 1,
  purpose: "meat" as (typeof PURPOSES)[number],
  expected_yield_lbs: "" as string | number,
  yield_unit: "lbs" as (typeof YIELD_UNITS)[number],
  status: "active" as (typeof STATUSES)[number],
  location: "",
  notes: "",
};

function LivestockPage() {
  const qc = useQueryClient();
  const list = useServerFn(listLivestock);
  const upsert = useServerFn(upsertLivestock);
  const remove = useServerFn(deleteLivestock);
  const bulk = useServerFn(bulkInsertLivestock);
  const dashFn = useServerFn(getLivestockDashboard);

  const { data: animals = [], isLoading } = useQuery({
    queryKey: ["livestock"],
    queryFn: () => list(),
  });
  const { data: dash } = useQuery({
    queryKey: ["livestock-dashboard"],
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
          breed: vars.breed || null,
          tag: vars.tag || null,
          sex: vars.sex || null,
          birth_date: vars.birth_date || null,
          quantity: Number(vars.quantity) || 1,
          purpose: vars.purpose,
          expected_yield_lbs:
            vars.expected_yield_lbs === "" || vars.expected_yield_lbs === null
              ? null
              : Number(vars.expected_yield_lbs),
          yield_unit: vars.yield_unit,
          status: vars.status,
          location: vars.location || null,
          notes: vars.notes || null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["livestock"] });
      qc.invalidateQueries({ queryKey: ["livestock-dashboard"] });
      setOpen(false);
      setForm(empty);
      toast.success("Saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["livestock"] });
      qc.invalidateQueries({ queryKey: ["livestock-dashboard"] });
      toast.success("Removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const importM = useMutation({
    mutationFn: (rows: AnimalInput[]) => bulk({ data: { animals: rows } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["livestock"] });
      qc.invalidateQueries({ queryKey: ["livestock-dashboard"] });
      toast.success(`Imported ${r.inserted} animals`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function openNew() {
    setForm(empty);
    setOpen(true);
  }
  function openEdit(a: Animal) {
    setForm({
      id: a.id,
      species: a.species,
      breed: a.breed ?? "",
      tag: a.tag ?? "",
      sex: a.sex ?? "",
      birth_date: a.birth_date ?? "",
      quantity: a.quantity,
      purpose: (PURPOSES as readonly string[]).includes(a.purpose) ? (a.purpose as any) : "meat",
      expected_yield_lbs: a.expected_yield_lbs ?? "",
      yield_unit: (YIELD_UNITS as readonly string[]).includes(a.yield_unit) ? (a.yield_unit as any) : "lbs",
      status: (STATUSES as readonly string[]).includes(a.status) ? (a.status as any) : "active",
      location: a.location ?? "",
      notes: a.notes ?? "",
    });
    setOpen(true);
  }

  function handleImport(file: File) {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const rows: Array<Parameters<typeof bulk>[0]["data"]["animals"][number]> = [];
        for (const r of res.data) {
          const species = String(r.species ?? r.Species ?? "").trim();
          if (!species) continue;
          const purposeRaw = String(r.purpose ?? "meat").trim().toLowerCase();
          const purpose = (PURPOSES as readonly string[]).includes(purposeRaw)
            ? (purposeRaw as (typeof PURPOSES)[number]) : "meat";
          const statusRaw = String(r.status ?? "active").trim().toLowerCase();
          const status = (STATUSES as readonly string[]).includes(statusRaw)
            ? (statusRaw as (typeof STATUSES)[number]) : "active";
          const yuRaw = String(r.yield_unit ?? "lbs").trim().toLowerCase();
          const yield_unit = (YIELD_UNITS as readonly string[]).includes(yuRaw)
            ? (yuRaw as (typeof YIELD_UNITS)[number]) : "lbs";
          const qty = parseInt(String(r.quantity ?? "1"), 10);
          const eyl = String(r.expected_yield_lbs ?? "").trim();
          rows.push({
            species,
            breed: String(r.breed ?? "").trim() || null,
            tag: String(r.tag ?? "").trim() || null,
            sex: String(r.sex ?? "").trim() || null,
            birth_date: String(r.birth_date ?? "").trim() || null,
            quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
            purpose,
            expected_yield_lbs: eyl === "" ? null : Number(eyl),
            yield_unit,
            status,
            location: String(r.location ?? "").trim() || null,
            notes: String(r.notes ?? "").trim() || null,
          });
        }
        if (!rows.length) {
          toast.error("No valid rows. Required column: species");
          return;
        }
        importM.mutate(rows);
      },
      error: (err) => toast.error(`Parse error: ${err.message}`),
    });
  }

  function handleExport() {
    const rows = (animals as Animal[]).map((a) => ({
      species: a.species,
      breed: a.breed ?? "",
      tag: a.tag ?? "",
      sex: a.sex ?? "",
      birth_date: a.birth_date ?? "",
      quantity: a.quantity,
      purpose: a.purpose,
      expected_yield_lbs: a.expected_yield_lbs ?? "",
      yield_unit: a.yield_unit,
      status: a.status,
      location: a.location ?? "",
      notes: a.notes ?? "",
    }));
    const csv = Papa.unparse(rows.length ? rows : [{
      species: "", breed: "", tag: "", sex: "", birth_date: "", quantity: "",
      purpose: "", expected_yield_lbs: "", yield_unit: "", status: "", location: "", notes: "",
    }]);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `livestock-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function printLivestock() {
    const list = animals as Animal[];
    const totalAnimals = list.reduce((s, a) => s + (a.quantity || 0), 0);
    const rows = list
      .map(
        (a) => `<tr>
          <td>${escapeHtml(a.species)}</td>
          <td>${escapeHtml(a.breed)}</td>
          <td>${escapeHtml(a.tag)}</td>
          <td>${escapeHtml(a.sex)}</td>
          <td>${escapeHtml(a.birth_date)}</td>
          <td style="text-align:right">${a.quantity}</td>
          <td>${escapeHtml(a.purpose)}</td>
          <td style="text-align:right">${a.expected_yield_lbs ?? ""}</td>
          <td>${escapeHtml(a.yield_unit)}</td>
          <td><span class="badge">${escapeHtml(a.status)}</span></td>
          <td>${escapeHtml(a.notes)}</td>
        </tr>`,
      )
      .join("");
    const body = list.length
      ? `<table>
          <thead><tr><th>Species</th><th>Breed</th><th>Tag</th><th>Sex</th><th>Birth</th><th>Qty</th><th>Purpose</th><th>Yield</th><th>Unit</th><th>Status</th><th>Notes</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
      : `<div class="empty-note">No livestock logged.</div>`;
    openPrintWindow(
      "Livestock",
      `<header><h1>Livestock</h1><div class="meta">${list.length} entries · ${totalAnimals} animals · printed ${new Date().toLocaleDateString()}</div></header>
       ${body}`,
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-mono font-semibold">Livestock</h2>
          <p className="text-sm text-muted-foreground">
            Animal protein producers — meat, dairy, eggs, fiber.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={printLivestock} disabled={isLoading}>
            <Printer className="h-4 w-4 mr-2" /> Print
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} disabled={isLoading}>
            <Download className="h-4 w-4 mr-2" /> Export CSV
          </Button>
          <Label htmlFor="livestock-csv" className="cursor-pointer">
            <span className="inline-flex items-center gap-2 border border-border rounded-md px-3 py-2 text-sm hover:bg-muted">
              {importM.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Import CSV
            </span>
            <input
              id="livestock-csv"
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
            <Plus className="h-4 w-4 mr-2" /> Add animal
          </Button>
        </div>
      </div>

      <YieldDashboard
        data={dash}
        labels={{
          unit: "animal",
          unitPlural: "animals",
          perUnitLabel: "lbs/animal",
          needUnitsLabel: "Need animals",
          totalUnitsCardLabel: "Total animals",
          yieldPanelTitle: "Livestock · estimated annual yield",
        }}
      />

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (animals as Animal[]).length === 0 ? (
        <div className="border border-dashed border-border rounded-lg p-10 text-center text-sm text-muted-foreground">
          <Beef className="h-8 w-8 mx-auto mb-2 opacity-50" />
          No livestock logged yet. Add an animal or import a CSV.
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs font-mono uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">Species</th>
                <th className="text-left px-3 py-2">Breed</th>
                <th className="text-left px-3 py-2">Tag</th>
                <th className="text-right px-3 py-2">Qty</th>
                <th className="text-left px-3 py-2">Purpose</th>
                <th className="text-right px-3 py-2">Est. yield</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Location</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(animals as Animal[]).map((a) => (
                <tr key={a.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono">{a.species}</td>
                  <td className="px-3 py-2 text-muted-foreground">{a.breed ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{a.tag ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-mono">{a.quantity}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className={PURPOSE_COLORS[a.purpose] ?? ""}>
                      {a.purpose}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                    {a.expected_yield_lbs != null ? `${a.expected_yield_lbs} ${a.yield_unit}` : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className={STATUS_COLORS[a.status] ?? ""}>
                      {a.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{a.location ?? "—"}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(a)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteM.mutate(a.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit animal" : "Add animal"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Species *</Label>
                <Input value={form.species} onChange={(e) => setForm({ ...form, species: e.target.value })} placeholder="Chicken" />
              </div>
              <div>
                <Label>Breed</Label>
                <Input value={form.breed} onChange={(e) => setForm({ ...form, breed: e.target.value })} placeholder="Rhode Island Red" />
              </div>
              <div>
                <Label>Tag / ID</Label>
                <Input value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })} placeholder="A-001" />
              </div>
              <div>
                <Label>Sex</Label>
                <Input value={form.sex} onChange={(e) => setForm({ ...form, sex: e.target.value })} placeholder="hen / rooster" />
              </div>
              <div>
                <Label>Birth date</Label>
                <Input type="date" value={form.birth_date} onChange={(e) => setForm({ ...form, birth_date: e.target.value })} />
              </div>
              <div>
                <Label>Quantity</Label>
                <Input type="number" min={1} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: parseInt(e.target.value) || 1 })} />
              </div>
              <div>
                <Label>Purpose</Label>
                <Select value={form.purpose} onValueChange={(v) => setForm({ ...form, purpose: v as any })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PURPOSES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as any })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Expected yield (per head)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.expected_yield_lbs}
                  onChange={(e) => setForm({ ...form, expected_yield_lbs: e.target.value })}
                  placeholder="auto from species"
                />
              </div>
              <div>
                <Label>Yield unit</Label>
                <Select value={form.yield_unit} onValueChange={(v) => setForm({ ...form, yield_unit: v as any })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {YIELD_UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label>Location</Label>
                <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="South pasture" />
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
