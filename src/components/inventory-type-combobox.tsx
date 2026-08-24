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
import { Check, ChevronsUpDown } from "lucide-react";
import { INVENTORY_TYPES } from "@/lib/obsidian-layout";
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
 * INVENTORY_TYPES catalog (including 32 Kits). Used by both Add Asset and
 * Edit Asset so the two never drift apart.
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
  const selected = INVENTORY_TYPES.find((t) => t.value === value);

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

  return (
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
            className,
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
            const type = INVENTORY_TYPES.find((t) => t.value === itemValue);
            if (!type) return 0;
            if (type.label.toLowerCase().includes(term) || type.value.toLowerCase().includes(term)) {
              return 1;
            }
            return 0;
          }}
        >
          <CommandInput placeholder="Search inventory types…" />
          <CommandList className="max-h-[260px]">
            <CommandEmpty>No type found.</CommandEmpty>
            <CommandGroup heading="Kits & assemblies">
              {INVENTORY_TYPES.filter((t) => t.value === KIT_TYPE).map(renderItem)}
            </CommandGroup>
            <CommandGroup heading="All inventory types">
              {INVENTORY_TYPES.filter((t) => t.value !== KIT_TYPE).map(renderItem)}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default InventoryTypeCombobox;
