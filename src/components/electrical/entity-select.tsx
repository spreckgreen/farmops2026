// Searchable picker for a relationship to an existing electrical record.
// The stored value is the target row's UUID; the human always sees the stable
// ID (PNL-FS-CRIT, JB-014, FS-097) plus enough context to pick the right one
// on a phone in the field.
import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { installStatusLabel } from "@/lib/electrical";
import type { EntityOption } from "@/lib/electrical.functions";

export function EntitySelect({
  label,
  hint,
  options,
  loading,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  options: EntityOption[];
  loading?: boolean;
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selected = useMemo(() => options.find((o) => o.id === value) ?? null, [options, value]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return options.slice(0, 100);
    return options
      .filter((o) =>
        `${o.stableId} ${o.label} ${o.context}`.toLowerCase().includes(needle),
      )
      .slice(0, 100);
  }, [options, search]);

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
                  <>
                    <span className="font-mono">{selected.stableId}</span>
                    {selected.label ? (
                      <span className="text-muted-foreground"> · {selected.label}</span>
                    ) : null}
                  </>
                ) : loading ? (
                  "Loading records…"
                ) : (
                  "Not linked"
                )}
              </span>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[min(22rem,90vw)] p-2" align="start">
            <Input
              autoFocus
              placeholder="Search by stable ID, grid or description"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="mt-2 max-h-64 overflow-y-auto">
              {!options.length ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">
                  No records exist yet to link to.
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
                      <span className="font-mono">{o.stableId}</span>
                      {o.label ? <span className="text-muted-foreground"> · {o.label}</span> : null}
                      <span className="block truncate text-xs text-muted-foreground">
                        {[o.context, o.installStatus ? installStatusLabel(o.installStatus) : ""]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>
        {selected ? (
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
