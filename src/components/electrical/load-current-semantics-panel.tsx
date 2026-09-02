// Phase 4.4b — per-load current-semantics section.
// Shows the legacy amps scalar separately from the eight additive semantic
// quantities, with provenance beside each value. A legacy value without proven
// semantics is labelled "semantic unresolved" — never as load current.
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AMPS_SEMANTIC_LABELS,
  loadCurrentSemantics,
  OPEN_CURRENT_SEMANTICS_FINDINGS,
} from "@/lib/electrical-current-model";

const show = (v: number | null) => (v === null ? "—" : String(v));

export function LoadCurrentSemanticsPanel({
  record,
  stableId,
}: {
  record: Record<string, unknown>;
  stableId: string;
}) {
  const view = loadCurrentSemantics(record);
  const open = OPEN_CURRENT_SEMANTICS_FINDINGS.filter((f) => f.stableId === stableId);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Current semantics</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="rounded-md border border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Legacy amps</span>
            <span className="font-mono">{show(view.legacyAmps)}</span>
            {view.legacyUnresolved ? (
              <Badge variant="destructive">semantic unresolved</Badge>
            ) : view.legacySemantic ? (
              <Badge variant="secondary">{AMPS_SEMANTIC_LABELS[view.legacySemantic]}</Badge>
            ) : (
              <Badge variant="outline">no value</Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {view.legacyProvenance ??
              "The legacy column is historically overloaded. It is preserved unchanged and is not treated as load current until provenance establishes its meaning."}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase text-muted-foreground">
                <th className="py-1 pr-3">Quantity</th>
                <th className="py-1 pr-3">Value (A)</th>
                <th className="py-1">Provenance</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((r) => (
                <tr key={r.semantic} className="border-t border-border align-top">
                  <td className="py-1.5 pr-3">{r.label}</td>
                  <td className="py-1.5 pr-3 font-mono">{show(r.value)}</td>
                  <td className="py-1.5 text-xs text-muted-foreground">
                    {r.value === null
                      ? "Not established — no backfill from legacy amps."
                      : (r.provenance ?? "Recorded without a provenance statement.")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {open.length ? (
          <div className="space-y-1 rounded-md border border-border bg-muted/40 p-3">
            <p className="text-xs font-medium">Open current-semantics findings for this load</p>
            {open.map((f) => (
              <p key={`${f.id}-${f.system}`} className="text-xs text-muted-foreground">
                <span className="font-mono">{f.id}</span> · {f.system === "farmops" ? "FarmOps" : "Canonical ODS"}{" "}
                {f.value} A · {f.classification} — {f.requires}
              </p>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
