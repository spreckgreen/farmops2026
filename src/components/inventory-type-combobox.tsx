import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, ChevronsUpDown, Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import { INVENTORY_TYPES } from "@/lib/obsidian-layout";
import { useInventoryTypeCatalog } from "@/hooks/use-inventory-type-catalog";
import { cn } from "@/lib/utils";

/** Catalog value for the "32 Kits" inventory type (seeded in every environment). */
export const KIT_TYPE = "32_kits";

/** Catalog label for a stored item_type value, e.g. "32_kits" -> "32 Kits". */
export function inventoryTypeLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return INVENTORY_TYPES.find((t) => t.value === value)?.label ?? null;
}

/**
 * Searchable, scrollable inventory type picker backed by the shared
 * inventory type catalog (including 32 Kits). Used by both Add Asset and
 * Edit Asset so the two never drift apart.
 *
 * States handled explicitly:
 *  - loading  → skeleton trigger + spinner row, picker disabled
 *  - fallback → built-in catalog used because the table read failed/was empty
 *  - empty    → no types at all, with a retry action instead of a blank list
 */
export function InventoryTypeCombobox({
  value,
  onChange,
  className,
  size = "default",
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  size?: "default" | "sm";
}) {
  const [open, setOpen] = useState(false);
  const { types, status, error, reload } = useInventoryTypeCatalog();
  const loading = status === "loading";
  const selected = types.find((t) => t.value === value);

  if (loading) {
    return (
      <div className={cn("space-y-1", className)}>
        <Skeleton className={cn("w-full rounded-md", size === "sm" ? "h-8" : "h-10")} />
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading inventory types…
        </p>
      </div>
    );
  }

  if (status === "empty") {
    return (
      <div className={cn("space-y-1", className)}>
        <Button
          type="button"
          variant="outline"
          size={size === "sm" ? "sm" : "default"}
          className="w-full justify-between font-normal text-muted-foreground"
          onClick={reload}
        >
          <span className="truncate">No inventory types available</span>
          <RefreshCw className="ml-2 h-4 w-4 shrink-0 opacity-60" />
        </Button>
        <p className="flex items-center gap-1.5 text-[11px] text-amber-500">
          <AlertTriangle className="h-3 w-3" />
          The type catalog is empty — retry, or seed the catalog in the backend.
        </p>
      </div>
    );
  }

  const renderItem = (t: { value: string; label: string }) => (
    <CommandItem
      key={t.value}
      value={t.value}
      onSelect={() => {
        onChange(t.value);
        setOpen(false);
      }}
    >
      <Check className={cn("mr-2 h-4 w-4", value === t.value ? "opacity-100" : "opacity-0")} />
      {t.label}
    </CommandItem>
  );

  const kits = types.filter((t) => t.value === KIT_TYPE);
  const rest = types.filter((t) => t.value !== KIT_TYPE);

  return (
    <div className={cn("space-y-1", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              "w-full justify-between font-normal",
              size === "sm" && "h-8 px-2 text-xs",
            )}
          >
            <span className={cn("truncate", !selected && "text-muted-foreground")}>
              {selected ? selected.label : value ? value : "— Unclassified —"}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command
            filter={(itemValue, search) => {
              const term = search.toLowerCase();
              const type = types.find((t) => t.value === itemValue);
              if (!type) return 0;
              if (
                type.label.toLowerCase().includes(term) ||
                type.value.toLowerCase().includes(term)
              ) {
                return 1;
              }
              return 0;
            }}
          >
            <CommandInput placeholder="Search inventory types…" />
            <CommandList className="max-h-[260px]">
              <CommandEmpty>No type matches that search.</CommandEmpty>
              {kits.length ? (
                <CommandGroup heading="Kits & assemblies">{kits.map(renderItem)}</CommandGroup>
              ) : null}
              <CommandGroup heading="All inventory types">{rest.map(renderItem)}</CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {status === "fallback" ? (
        <p className="flex items-center gap-1.5 text-[11px] text-amber-500">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span className="truncate">
            Using built-in type list{error ? " (catalog unavailable)" : ""}.
          </span>
          <button
            type="button"
            onClick={reload}
            className="underline underline-offset-2 hover:text-foreground"
          >
            Retry
          </button>
        </p>
      ) : null}
    </div>
  );
}

export default InventoryTypeCombobox;
