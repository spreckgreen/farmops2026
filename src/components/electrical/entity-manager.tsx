// Generic list + create/edit surface for every electrical entity kind.
// Field definitions come from @/lib/electrical-entities so the UI, the server
// whitelist and the ODS importer can never disagree about an entity's shape.
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  deleteElectrical,
  listElectrical,
  saveElectrical,
  suggestStableId,
  type ElectricalRow,
} from "@/lib/electrical.functions";
import { ENTITIES, type EntityField } from "@/lib/electrical-entities";
import {
  INSTALL_STATUSES,
  RACEWAY_ENVIRONMENTS,
  checkStableId,
  installStatusLabel,
  type ElectricalEntityKind,
} from "@/lib/electrical";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Trash2, Pencil, Search } from "lucide-react";

type Values = Record<string, string | boolean>;

function toValues(def: (typeof ENTITIES)[ElectricalEntityKind], row?: ElectricalRow): Values {
  const values: Values = { [def.stableIdField]: String(row?.[def.stableIdField] ?? "") };
  for (const f of def.fields) {
    const raw = row?.[f.key];
    values[f.key] = f.kind === "bool" ? Boolean(raw) : raw == null ? "" : String(raw);
  }
  return values;
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: EntityField;
  value: string | boolean;
  onChange: (v: string | boolean) => void;
}) {
  if (field.kind === "bool") {
    return (
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={Boolean(value)} onCheckedChange={(c) => onChange(Boolean(c))} />
        {field.label}
      </label>
    );
  }
  if (field.kind === "textarea") {
    return (
      <div className="space-y-1">
        <Label className="text-xs">{field.label}</Label>
        <Textarea rows={3} value={String(value)} onChange={(e) => onChange(e.target.value)} />
      </div>
    );
  }
  if (field.kind === "select") {
    return (
      <div className="space-y-1">
        <Label className="text-xs">{field.label}</Label>
        <select
          className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">—</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {field.key === "install_status" ? installStatusLabel(o) : o}
            </option>
          ))}
        </select>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <Label className="text-xs">{field.label}</Label>
      <Input
        type={field.kind === "number" ? "number" : "text"}
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function EntityManager({ kind }: { kind: ElectricalEntityKind }) {
  const def = ENTITIES[kind];
  const qc = useQueryClient();
  const list = useServerFn(listElectrical);
  const save = useServerFn(saveElectrical);
  const remove = useServerFn(deleteElectrical);
  const suggest = useServerFn(suggestStableId);

  const [search, setSearch] = useState("");
  const [environment, setEnvironment] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<{ row?: ElectricalRow } | null>(null);
  const [values, setValues] = useState<Values>({});

  const query = useQuery({
    queryKey: ["electrical", kind, environment, status],
    queryFn: () =>
      list({ data: { kind, environment: environment || undefined, status: status || undefined } }),
  });

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const data = query.data ?? [];
    if (!needle) return data;
    return data.filter((r) =>
      Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(needle)),
    );
  }, [query.data, search]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["electrical"] });
  };

  const saveMutation = useMutation({
    mutationFn: async () => save({ data: { kind, id: editing?.row?.["id"] as string | undefined, values } }),
    onSuccess: () => {
      toast.success(`Saved ${def.singular}`);
      setEditing(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => remove({ data: { kind, id } }),
    onSuccess: () => {
      toast.success(`Deleted ${def.singular}`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openNew = async () => {
    const next = toValues(def);
    try {
      const { suggestion } = await suggest({ data: { kind } });
      if (suggestion) next[def.stableIdField] = suggestion;
    } catch {
      // Suggestion is a convenience only — never block creating a record.
    }
    setValues(next);
    setEditing({});
  };

  const openEdit = (row: ElectricalRow) => {
    setValues(toValues(def, row));
    setEditing({ row });
  };

  const idCheck = editing ? checkStableId(kind, String(values[def.stableIdField] ?? "")) : null;
  const listFields = def.fields.filter((f) => f.list);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder={`Search ${def.title.toLowerCase()} by ID, grid or description`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {kind === "raceway" ? (
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={environment}
            onChange={(e) => setEnvironment(e.target.value)}
          >
            <option value="">All environments</option>
            {RACEWAY_ENVIRONMENTS.map((e) => (
              <option key={e} value={e}>
                {e.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        ) : null}
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          {INSTALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {installStatusLabel(s)}
            </option>
          ))}
        </select>
        <Button onClick={() => void openNew()} className="gap-1">
          <Plus className="h-4 w-4" />
          New {def.singular}
        </Button>
      </div>

      {query.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : query.error ? (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            {(query.error as Error).message}
          </CardContent>
        </Card>
      ) : !rows.length ? (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground text-center">
            No {def.title.toLowerCase()} yet. Add one by hand, or import the engineering
            spreadsheet from the ODS import tab.
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">{def.stableIdLabel}</th>
                {listFields.map((f) => (
                  <th key={f.key} className="px-3 py-2 font-medium whitespace-nowrap">
                    {f.label}
                  </th>
                ))}
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={String(row["id"])} className="border-t border-border">
                  <td className="px-3 py-2 font-mono whitespace-nowrap">
                    <Link
                      to="/electrical/item/$kind/$id"
                      params={{ kind, id: String(row["id"]) }}
                      className="underline underline-offset-2"
                    >
                      {String(row[def.stableIdField] ?? "")}
                    </Link>
                  </td>
                  {listFields.map((f) => (
                    <td key={f.key} className="px-3 py-2 align-top">
                      {f.kind === "bool" ? (
                        row[f.key] ? (
                          <Badge variant="secondary">yes</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )
                      ) : f.key === "install_status" ? (
                        <Badge variant="outline">{installStatusLabel(String(row[f.key] ?? ""))}</Badge>
                      ) : (
                        String(row[f.key] ?? "") || <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(row)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (confirm(`Delete ${String(row[def.stableIdField])}?`)) {
                          deleteMutation.mutate(String(row["id"]));
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing?.row ? "Edit" : "New"} {def.singular}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">{def.stableIdLabel}</Label>
              <Input
                className="font-mono"
                value={String(values[def.stableIdField] ?? "")}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [def.stableIdField]: e.target.value.toUpperCase() }))
                }
              />
              {idCheck?.error ? (
                <p className="text-xs text-destructive">{idCheck.error}</p>
              ) : idCheck?.warning ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">{idCheck.warning}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Stable IDs never change once assigned — they carry no physical attributes.
                </p>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {def.fields.map((f) => (
                <FieldInput
                  key={f.key}
                  field={f}
                  value={values[f.key] ?? (f.kind === "bool" ? false : "")}
                  onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
                />
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              disabled={Boolean(idCheck?.error) || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
