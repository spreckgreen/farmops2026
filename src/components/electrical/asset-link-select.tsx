// Phase 4.4a — infrastructure asset integration.
//
// Infrastructure records (racks, power distribution assets, powered devices)
// describe role and topology. The physical equipment's manufacturer, model,
// serial, cost, warranty, manuals, maintenance schedules and lifecycle live in
// the existing FarmOps Inventory/Asset record, so this picker links to that
// record instead of asking for the same details a second time.
//
// The link is optional (planned infrastructure and passive structures have no
// asset), and replacing the physical unit is just a different link here — the
// stable infrastructure ID and all topology stay as they are.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, ChevronsUpDown, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { createInventory, listInventory } from "@/lib/inventory.functions";

interface AssetOption {
  id: string;
  name: string;
  context: string;
}

export function AssetLinkSelect({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const qc = useQueryClient();
  const list = useServerFn(listInventory);
  const create = useServerFn(createInventory);

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");

  const query = useQuery({
    queryKey: ["inventory", "asset-link"],
    queryFn: () => list(),
  });

  const options = useMemo<AssetOption[]>(
    () =>
      (query.data ?? []).map((row) => {
        const r = row as Record<string, unknown>;
        return {
          id: String(r["id"]),
          name: String(r["name"] ?? "") || "(unnamed asset)",
          context: [r["item_type"], r["category"], r["location"], r["sku"]]
            .map((v) => String(v ?? "").trim())
            .filter(Boolean)
            .join(" · "),
        };
      }),
    [query.data],
  );

  const selected = useMemo(() => options.find((o) => o.id === value) ?? null, [options, value]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return options.slice(0, 100);
    return options
      .filter((o) => `${o.name} ${o.context}`.toLowerCase().includes(needle))
      .slice(0, 100);
  }, [options, search]);

  const createMutation = useMutation({
    mutationFn: async (name: string) => create({ data: { name } }),
    onSuccess: (row) => {
      const created = row as unknown as { id: string; name: string | null };
      void qc.invalidateQueries({ queryKey: ["inventory"] });
      onChange(created.id);
      setNewName("");
      setSearch("");
      setOpen(false);
      toast.success(`Created asset “${created.name ?? ""}” and linked it`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex gap-1">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="h-10 flex-1 justify-between font-normal"
            >
              <span className="truncate text-left">
                {selected ? (
                  selected.name
                ) : value ? (
                  <span className="text-muted-foreground">Linked asset (loading…)</span>
                ) : query.isLoading ? (
                  "Loading assets…"
                ) : (
                  "No asset linked"
                )}
              </span>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[min(24rem,90vw)] p-2" align="start">
            <Input
              autoFocus
              placeholder="Search inventory by name, type or location"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="mt-2 max-h-56 overflow-y-auto">
              {!options.length ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">
                  No inventory assets yet — create one below.
                </p>
              ) : !filtered.length ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">No matches.</p>
              ) : (
                filtered.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    className="flex w-full items-start gap-2 rounded px-2 py-2 text-left text-sm hover:bg-accent"
                    onClick={() => {
                      onChange(o.id);
                      setOpen(false);
                      setSearch("");
                    }}
                  >
                    <Check
                      className={`mt-0.5 h-4 w-4 shrink-0 ${o.id === value ? "opacity-100" : "opacity-0"}`}
                    />
                    <span className="min-w-0">
                      {o.name}
                      {o.context ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {o.context}
                        </span>
                      ) : null}
                    </span>
                  </button>
                ))
              )}
            </div>
            <div className="mt-2 space-y-1 border-t border-border pt-2">
              <Label className="text-xs">Not in inventory yet?</Label>
              <div className="flex gap-1">
                <Input
                  placeholder="New asset name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <Button
                  type="button"
                  size="icon"
                  className="shrink-0"
                  aria-label="Create asset and link"
                  disabled={!newName.trim() || createMutation.isPending}
                  onClick={() => createMutation.mutate(newName.trim())}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Creates the Asset record in Inventory and links it here. Fill in serial, cost,
                warranty and maintenance on the asset itself.
              </p>
            </div>
          </PopoverContent>
        </Popover>
        {value ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10"
            aria-label={`Clear ${label}`}
            onClick={() => onChange("")}
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
