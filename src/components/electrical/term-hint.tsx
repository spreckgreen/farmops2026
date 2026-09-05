// Contextual help for any electrical term that could be mistaken for an
// NEC-defined object. Renders the canonical term with a hint button carrying the
// plain-language explanation, the NEC relationship and the code-of-record notice.

import { Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NEC_PROFILE, term } from "@/lib/electrical-terminology";

export function TermHint({
  id,
  label,
  className,
}: {
  id: string;
  label?: string;
  className?: string;
}) {
  const t = term(id);
  if (!t) return <span className={className}>{label ?? id}</span>;
  const operational = t.classification === "FARMOPS_OPERATIONAL";
  return (
    <span className={`inline-flex items-center gap-1 ${className ?? ""}`}>
      <span>{label ?? t.canonical}</span>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`What does ${t.canonical} mean?`}
            className="text-muted-foreground hover:text-foreground"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80 space-y-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{t.canonical}</span>
            <Badge variant={operational ? "outline" : "secondary"}>
              {operational ? "FarmOps term" : "NEC term"}
            </Badge>
          </div>
          <p className="text-muted-foreground">{t.plain}</p>
          {operational ? (
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">How it relates to the code: </span>
              {t.necRelation}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t.necEdition} — {t.necReference}
            </p>
          )}
          {t.aliases.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Also searchable as: {t.aliases.join(", ")}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">{NEC_PROFILE.notice}</p>
        </PopoverContent>
      </Popover>
    </span>
  );
}
