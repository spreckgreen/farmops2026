// Generic list + create/edit surface for every electrical entity kind.
// Field definitions come from @/lib/electrical-entities so the UI, the server
// whitelist and the ODS importer can never disagree about an entity's shape.
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  electricalEntityOptions,
  listElectrical,
  saveElectrical,
  suggestStableId,
  type ElectricalRow,
  type EntityOption,
} from "@/lib/electrical.functions";
import { ENTITIES, type EntityField } from "@/lib/electrical-entities";
import { relationsFor } from "@/lib/electrical-relations";
import { EntitySelect } from "@/components/electrical/entity-select";
import { AssetLinkSelect } from "@/components/electrical/asset-link-select";
import { StableIdHelp } from "@/components/electrical/stable-id-help";
import {
  INSTALL_STATUSES,
  RACEWAY_ENVIRONMENTS,
  checkStableId,
  nextBranchId,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { booleanSelectValue } from "@/lib/electrical-boolean";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Pencil, Search, Download, FileJson, X } from "lucide-react";
import { rowsToCsv, downloadCsv } from "@/lib/csv";
import { DeleteDependencyDialog } from "@/components/electrical/delete-dependency-dialog";

type Values = Record<string, string | boolean>;

function toValues(def: (typeof ENTITIES)[ElectricalEntityKind], row?: ElectricalRow): Values {
  const values: Values = { [def.stableIdField]: String(row?.[def.stableIdField] ?? "") };
  for (const f of def.fields) {
    const raw = row?.[f.key];
    values[f.key] = f.kind === "bool" ? booleanSelectValue(raw) : raw == null ? "" : String(raw);
  }
  return values;
}

function FieldInput({
  field,
  value,
  onChange,
  options,
  optionsLoading,
}: {
  field: EntityField;
  value: string | boolean;
  onChange: (v: string | boolean) => void;
  options?: EntityOption[];
  optionsLoading?: boolean;
}) {
  if (field.kind === "asset") {
    return (
      <AssetLinkSelect
        label={field.label}
        hint={field.hint}
        value={String(value)}
        onChange={onChange}
      />
    );
  }
  if (field.kind === "entity") {
    return (
      <EntitySelect
        label={field.label}
        hint={field.hint}
        options={options ?? []}
        loading={optionsLoading}
        value={String(value)}
        onChange={onChange}
      />
    );
  }
  if (field.readOnly) {
    return (
      <div className="space-y-1">
        <Label className="text-xs">{field.label}</Label>
        <Input readOnly disabled className="font-mono" value={String(value)} />
        <p className="text-xs text-muted-foreground">
          {field.hint ?? "Derived from the linked record."}
        </p>
      </div>
    );
  }
  if (field.kind === "bool") {
    // Tri-state: leaving a field "Not stated" stores null instead of forcing
    // a "no" that the engineering source never said.
    const current = booleanSelectValue(value);
    return (
      <div className="space-y-1">
        <Label className="text-xs">{field.label}</Label>
        <Select value={current} onValueChange={(v) => onChange(v)}>
          <SelectTrigger>
            <SelectValue placeholder="Not stated" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="yes">Yes</SelectItem>
            <SelectItem value="no">No</SelectItem>
            <SelectItem value="unknown">Not stated</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {field.hint ?? "Not stated leaves this engineering value unknown."}
        </p>
      </div>
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
    const current = String(value);
    const known = field.options ?? [];
    // A legacy imported value (engineering text in install_status) must stay
    // visible instead of being silently swapped for the first valid option.
    const legacy = current && !known.includes(current) ? current : null;
    return (
      <div className="space-y-1">
        <Label className="text-xs">{field.label}</Label>
        <select
          className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={current}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">—</option>
          {legacy ? <option value={legacy}>{legacy} (legacy — not allowed)</option> : null}
          {known.map((o) => (
            <option key={o} value={o}>
              {field.key === "install_status" ? installStatusLabel(o) : o}
            </option>
          ))}
        </select>
        {legacy ? (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            This value came from the spreadsheet and the database will reject it — choose a
            real status before saving, or run “Fix legacy statuses” on the QA page.
          </p>
        ) : null}

        {field.hint ? <p className="text-xs text-muted-foreground">{field.hint}</p> : null}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <Label className="text-xs">{field.label}</Label>
      <Input
        className="h-10"
        type={field.kind === "number" ? "number" : "text"}
        inputMode={field.kind === "number" ? "decimal" : undefined}
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
      />
      {field.hint ? <p className="text-xs text-muted-foreground">{field.hint}</p> : null}
    </div>
  );
}


export function EntityManager({
  kind,
  openEditId,
  onEditHandled,
}: {
  kind: ElectricalEntityKind;
  /** Opens the edit dialog for this row id once the list has loaded (deep link from a detail page). */
  openEditId?: string | undefined;
  onEditHandled?: (() => void) | undefined;
}) {
  const def = ENTITIES[kind];
  const qc = useQueryClient();
  const list = useServerFn(listElectrical);
  const save = useServerFn(saveElectrical);
  const suggest = useServerFn(suggestStableId);
  const loadOptions = useServerFn(electricalEntityOptions);

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

  // Records this kind can be linked to, so the relationship pickers show stable
  // IDs instead of asking for typed-in references.
  const relationKinds = useMemo(
    () => [...new Set(relationsFor(kind).map((r) => r.targetKind))],
    [kind],
  );
  const optionsQuery = useQuery({
    queryKey: ["electrical", "options", relationKinds],
    queryFn: () => loadOptions({ data: { kinds: relationKinds } }),
    enabled: relationKinds.length > 0 && Boolean(editing),
  });

  // Branch IDs inherit the junction box they originate from (BR-104-02-03), so a
  // new branch is renumbered as soon as its origin box is chosen.
  const creating = Boolean(editing && !editing.row);
  const originJboxUuid = kind === "branch" ? String(values["source_jbox_uuid"] ?? "") : "";
  useEffect(() => {
    if (!creating || kind !== "branch" || !originJboxUuid) return;
    const parent = (optionsQuery.data?.["jbox"] ?? []).find((o) => o.id === originJboxUuid);
    if (!parent?.stableId) return;
    const existing = (query.data ?? []).map((r) => String(r[def.stableIdField] ?? ""));
    const suggestion = nextBranchId(parent.stableId, existing);
    if (!suggestion) return;
    setValues((prev) =>
      prev[def.stableIdField] === suggestion
        ? prev
        : { ...prev, [def.stableIdField]: suggestion },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creating, kind, originJboxUuid, optionsQuery.data, query.data, def.stableIdField]);



  // Field-work values first (what gets edited on a phone), then relationships,
  // then the engineering values the canonical ODS still governs.
  const groups = useMemo(() => {
    const relation = def.fields.filter(
      (f) => f.kind === "entity" || f.kind === "asset" || f.readOnly,
    );
    const fieldWork = def.fields.filter((f) => f.field && !relation.includes(f));
    const engineering = def.fields.filter(
      (f) => f.engineering && !relation.includes(f) && !fieldWork.includes(f),
    );
    const rest = def.fields.filter(
      (f) => !relation.includes(f) && !fieldWork.includes(f) && !engineering.includes(f),
    );
    const all: { title: string; fields: EntityField[]; note?: string }[] = [
      {
        title: "Field work",
        fields: fieldWork,
        note: "Status, measurements and notes recorded on site.",
      },
      {
        title: "Topology & asset link",
        fields: relation,
        note: "Pick existing records — the link, not the typed ID, is authoritative. Equipment identity, cost, warranty and maintenance live on the linked inventory asset.",
      },
      { title: "Details", fields: rest },
      {
        title: "Engineering values (ODS-controlled)",
        fields: engineering,
        note: "The canonical electrical spreadsheet remains the authority for these. Edit only to match a released revision.",
      },
    ];
    return all.filter((g) => g.fields.length > 0);
  }, [def]);



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

  // Row deletes go through DeleteDependencyDialog so every tab gets the same
  // dependency breakdown and guided cleanup before anything is removed.



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

  // Deep link from a record detail page: /electrical/raceway?edit=<uuid>
  useEffect(() => {
    if (!openEditId || editing) return;
    const row = (query.data ?? []).find((r) => String(r["id"]) === openEditId);
    if (!row) return;
    setValues(toValues(def, row));
    setEditing({ row });
    onEditHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openEditId, query.data]);

  // Create and edit share one validator; only the mode differs, so legacy
  // compatibility IDs stay valid while editing and are refused for new records.
  const idCheck = editing
    ? checkStableId(kind, String(values[def.stableIdField] ?? ""), {
        mode: creating ? "create" : "existing",
      })
    : null;
  const listFields = def.fields.filter((f) => f.list);

  // Export columns mirror the record shape: stable ID first, then every defined
  // field, so a CSV/JSON export round-trips what the tab actually stores.
  const exportColumns = useMemo(
    () => [
      { key: def.stableIdField, label: def.stableIdLabel },
      ...def.fields.map((f) => ({ key: f.key, label: f.label })),
    ],
    [def],
  );

  const total = query.data?.length ?? 0;
  const filtered = rows.length;
  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const s = String(r["install_status"] ?? "") || "unspecified";
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const stamp = new Date().toISOString().slice(0, 10);

  const exportCsv = () => {
    const body = rowsToCsv(
      rows.map((r) => {
        const out: Record<string, unknown> = {};
        for (const c of exportColumns) out[c.key] = r[c.key] ?? "";
        return out;
      }),
      exportColumns,
    );
    downloadCsv(`electrical-${kind}-${stamp}.csv`, body);
  };

  const exportJson = () => {
    const body = JSON.stringify(
      {
        kind,
        title: def.title,
        generatedAt: new Date().toISOString(),
        filters: { search: search.trim() || null, environment: environment || null, status: status || null },
        count: filtered,
        totalBeforeFilters: total,
        rows: rows.map((r) => {
          const out: Record<string, unknown> = {};
          for (const c of exportColumns) out[c.key] = r[c.key] ?? null;
          return out;
        }),
      },
      null,
      2,
    );
    const url = URL.createObjectURL(new Blob([body], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `electrical-${kind}-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

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

      {total > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            {filtered === total
              ? `${total} ${def.title.toLowerCase()}`
              : `${filtered} of ${total} ${def.title.toLowerCase()}`}
          </Badge>
          {statusCounts.map(([s, n]) => (
            <Badge key={s} variant="outline">
              {s === "unspecified" ? "No status" : installStatusLabel(s)}: {n}
            </Badge>
          ))}
          {search || environment || status ? (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1"
              onClick={() => {
                setSearch("");
                setEnvironment("");
                setStatus("");
              }}
            >
              <X className="h-4 w-4" />
              Clear filters
            </Button>
          ) : null}
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              disabled={!filtered}
              onClick={exportCsv}
            >
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              disabled={!filtered}
              onClick={exportJson}
            >
              <FileJson className="h-4 w-4" />
              Export JSON
            </Button>
          </div>
        </div>
      ) : null}

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
            {query.data?.length ? (
              <>
                No {def.title.toLowerCase()} match the current search or filters. Clear them to
                show all {def.title.toLowerCase()}.
              </>
            ) : (
              <>
                No {def.title.toLowerCase()} yet. Add one by hand, or import the engineering
                spreadsheet from the ODS import tab.
              </>
            )}
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
                        row[f.key] === true ? (
                          <Badge variant="secondary">yes</Badge>
                        ) : row[f.key] === false ? (
                          <Badge variant="outline">no</Badge>
                        ) : (
                          <span className="text-muted-foreground">not stated</span>
                        )
                      ) : f.key === "install_status" ? (
                        <Badge variant="outline">{installStatusLabel(String(row[f.key] ?? ""))}</Badge>
                      ) : f.key === "completion_percent" ? (
                        (() => {
                          const p = displayCompletionPercent(
                            row["install_status"] as string | null,
                            row[f.key] as number | null,
                          );
                          return p.percent == null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span>{p.percent}%</span>
                          );
                        })()
                      ) : (
                        String(row[f.key] ?? "") || <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Edit ${String(row[def.stableIdField] ?? "")}`}
                      onClick={() => openEdit(row)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <DeleteDependencyDialog
                      iconOnly
                      kind={kind}
                      id={String(row["id"])}
                      label={String(row[def.stableIdField] ?? "")}
                      singular={def.singular}
                      onDeleted={() => void query.refetch()}
                    />
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
              ) : null}
              <StableIdHelp kind={kind} value={String(values[def.stableIdField] ?? "")} />
            </div>
            {groups.map((group) => (
              <div key={group.title} className="space-y-2">
                <div>
                  <h4 className="text-sm font-medium">{group.title}</h4>
                  {group.note ? (
                    <p className="text-xs text-muted-foreground">{group.note}</p>
                  ) : null}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {group.fields.map((f) => (
                    <FieldInput
                      key={f.key}
                      field={f}
                      value={values[f.key] ?? (f.kind === "bool" ? "unknown" : "")}
                      onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
                      options={f.entityKind ? (optionsQuery.data?.[f.entityKind] ?? []) : undefined}
                      optionsLoading={optionsQuery.isLoading}
                    />
                  ))}
                </div>
              </div>
            ))}

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
