import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, Copy, Check } from "lucide-react";
import { toast } from "sonner";

type Preset = {
  label: string;
  description: string;
  sql: string;
};

const PRESETS: Record<"inventory" | "maintenance", Preset[]> = {
  inventory: [
    {
      label: "assets → inventory CSV",
      description:
        "Run in the Welcoming Pages backend (SQL editor). Downloads as CSV that the Import button accepts.",
      sql: `COPY (
  SELECT
    id::text AS sku,
    name,
    description,
    category,
    location,
    quantity,
    min_quantity,
    status,
    barcode,
    array_to_string(tags, ';') AS tags,
    current_hours,
    current_miles,
    usage_tracking
  FROM public.assets
  WHERE user_id = auth.uid()
) TO STDOUT WITH CSV HEADER;`,
    },
    {
      label: "consumables → inventory CSV",
      description:
        "Same idea for the consumables stock — maps to inventory_items via the importer aliases.",
      sql: `COPY (
  SELECT
    name,
    category,
    unit,
    quantity_in_stock AS quantity,
    min_quantity,
    cost_per_unit AS unit_cost
  FROM public.consumables
  WHERE user_id = auth.uid()
) TO STDOUT WITH CSV HEADER;`,
    },
  ],
  maintenance: [
    {
      label: "service_schedules → maintenance CSV",
      description:
        "Includes title, scheduled & completed dates, recurrence, and the asset name (joined).",
      sql: `COPY (
  SELECT
    s.title,
    a.name AS asset_name,
    s.service_type,
    s.status,
    s.scheduled_date,
    s.completed_date,
    s.recurrence,
    s.description,
    s.notes,
    s.consumables_used::text AS consumables_used
  FROM public.service_schedules s
  LEFT JOIN public.assets a ON a.id = s.asset_id
  WHERE s.user_id = auth.uid()
  ORDER BY s.scheduled_date
) TO STDOUT WITH CSV HEADER;`,
    },
  ],
};

export function WelcomingPagesImportHelper({
  kind,
}: {
  kind: "inventory" | "maintenance";
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const presets = PRESETS[kind];

  const copy = async (sql: string, label: string) => {
    try {
      await navigator.clipboard.writeText(sql);
      setCopied(label);
      toast.success("SQL copied — paste into Welcoming Pages SQL editor");
      setTimeout(() => setCopied(null), 1800);
    } catch {
      toast.error("Couldn't copy — select & copy manually");
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card/40 mb-6 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-5 py-3 text-left hover:bg-card/80 transition"
      >
        <div>
          <div className="text-sm font-semibold text-primary">
            Bring {kind} data from Welcoming Pages
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Cross-project DB access isn't available — run this SQL there to export, then upload here.
          </div>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="border-t border-border divide-y divide-border">
          {presets.map((p) => (
            <div key={p.label} className="px-5 py-4">
              <div className="flex items-center justify-between gap-3 mb-1">
                <div className="text-sm font-medium">{p.label}</div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => copy(p.sql, p.label)}
                  className="text-muted-foreground hover:text-primary h-7"
                >
                  {copied === p.label ? (
                    <>
                      <Check className="h-3.5 w-3.5 mr-1" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5 mr-1" /> Copy SQL
                    </>
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mb-2">{p.description}</p>
              <pre className="text-[11px] leading-relaxed text-foreground/80 bg-background border border-border rounded-md p-3 overflow-x-auto">
                {p.sql}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
