import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Link2, Plus, Trash2, Package, Wrench, AlertTriangle } from "lucide-react";
import {
  listProcedureLinks,
  createProcedureLink,
  deleteProcedureLink,
  listLinkTargets,
  relinkProcedureLink,
  type LinkTargetKind,
  type ProcedureLinkRow,
  type LinkTargetOption,
} from "@/lib/procedure-links.functions";

export function ProcedureLinks({ procedureName }: { procedureName: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listProcedureLinks);
  const createFn = useServerFn(createProcedureLink);
  const deleteFn = useServerFn(deleteProcedureLink);
  const targetsFn = useServerFn(listLinkTargets);
  const relinkFn = useServerFn(relinkProcedureLink);

  const [kind, setKind] = useState<LinkTargetKind>("inventory");
  const [adding, setAdding] = useState(false);
  const [relinkingId, setRelinkingId] = useState<string | null>(null);

  const key = ["procedure-links", procedureName];
  const { data: links = [] } = useQuery<ProcedureLinkRow[]>({
    queryKey: key,
    queryFn: () => listFn({ data: { procedureName } }),
  });

  const { data: targets = [] } = useQuery<LinkTargetOption[]>({
    queryKey: ["link-targets", kind],
    queryFn: () => targetsFn({ data: { kind } }),
    enabled: adding,
  });

  // Eligible replacement assets (equipment / ham radio gear) for flagged links.
  const { data: eligibleAssets = [] } = useQuery<LinkTargetOption[]>({
    queryKey: ["link-targets", "inventory"],
    queryFn: () => targetsFn({ data: { kind: "inventory" } }),
    enabled: relinkingId !== null,
  });

  const relinkMut = useMutation({
    mutationFn: (vars: { id: string; inventoryItemId: string }) => relinkFn({ data: vars }),
    onSuccess: (res) => {
      toast.success(`Relinked to ${(res as { label?: string })?.label ?? "asset"}`);
      setRelinkingId(null);
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["procedures"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const createMut = useMutation({
    mutationFn: (vars: { targetId: string }) =>
      createFn({ data: { procedureName, kind, targetId: vars.targetId } }),
    onSuccess: () => {
      toast.success("Linked");
      setAdding(false);
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["procedures"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Link removed");
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["procedures"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });


  return (
    <div className="border border-border/60 rounded-md p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Link2 size={13} /> Linked to
        </div>
        {!adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus size={12} /> Link…
          </Button>
        )}
      </div>

      {adding && (
        <div className="flex flex-wrap items-center gap-2 bg-muted/30 rounded p-2">
          <div className="flex rounded overflow-hidden border border-border text-xs">
            <button
              type="button"
              onClick={() => setKind("inventory")}
              className={`px-2 py-1 flex items-center gap-1 ${kind === "inventory" ? "bg-primary text-primary-foreground" : "bg-background"}`}
            >
              <Package size={11} /> Inventory
            </button>
            <button
              type="button"
              onClick={() => setKind("maintenance")}
              className={`px-2 py-1 flex items-center gap-1 ${kind === "maintenance" ? "bg-primary text-primary-foreground" : "bg-background"}`}
            >
              <Wrench size={11} /> Maintenance
            </button>
          </div>
          <select
            className="flex-1 min-w-[200px] h-7 text-xs rounded border border-border bg-background px-2"
            defaultValue=""
            onChange={(e) => {
              const id = e.target.value;
              if (id) createMut.mutate({ targetId: id });
            }}
            disabled={createMut.isPending}
          >
            <option value="" disabled>
              {targets.length ? `Choose ${kind === "inventory" ? "an item" : "a record"}…` : "Loading…"}
            </option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </div>
      )}

      {links.length === 0 ? (
        <p className="text-[11px] text-muted-foreground italic">Not linked to any inventory item or maintenance record.</p>
      ) : (
        <ul className="space-y-1">
          {links.map((l) => (
            <li
              key={l.id}
              className={`text-xs border rounded px-2 py-1.5 bg-background ${l.needs_relink ? "border-destructive/50" : "border-border/40"}`}
            >
              <div className="flex items-center gap-2">
                {l.kind === "inventory" ? (
                  <Package size={12} className="text-muted-foreground" />
                ) : (
                  <Wrench size={12} className="text-muted-foreground" />
                )}
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground w-20">
                  {l.kind}
                </span>
                <span className="flex-1 truncate">{l.target_label}</span>
                {l.needs_relink && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setRelinkingId(relinkingId === l.id ? null : l.id)}
                  >
                    Relink…
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (confirm("Remove this link?")) deleteMut.mutate(l.id);
                  }}
                >
                  <Trash2 size={12} className="text-destructive" />
                </Button>
              </div>

              {l.needs_relink && (
                <div className="mt-1 flex items-start gap-1.5 text-[11px] text-destructive">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  <span>{l.relink_reason ?? "This link needs to point at equipment or ham radio gear."}</span>
                </div>
              )}

              {relinkingId === l.id && (
                <div className="mt-2 flex flex-wrap items-center gap-2 bg-muted/30 rounded p-2">
                  <select
                    className="flex-1 min-w-[200px] h-7 text-xs rounded border border-border bg-background px-2"
                    defaultValue=""
                    disabled={relinkMut.isPending}
                    onChange={(e) => {
                      const id = e.target.value;
                      if (id) relinkMut.mutate({ id: l.id, inventoryItemId: id });
                    }}
                  >
                    <option value="" disabled>
                      {eligibleAssets.length ? "Choose equipment or ham radio…" : "Loading…"}
                    </option>
                    {eligibleAssets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <Button size="sm" variant="ghost" onClick={() => setRelinkingId(null)}>
                    Cancel
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
