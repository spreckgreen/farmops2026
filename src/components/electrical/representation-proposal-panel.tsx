// Phase 4.4b — FS-034 / FS-092 voltage & VA representation proposal (UI).
//
// Read-only by construction: no Apply button, no mutation, no write path. It
// shows both correct statements of each installation side by side.
import { useMemo } from "react";
import { Download } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  REPRESENTATION_CONCEPTS,
  REPRESENTATION_CONCEPT_LABELS,
  REPRESENTATION_DISPOSITION_LABELS,
  REPRESENTATION_FIXTURE_IDS,
  VA_BASIS_LABELS,
  representationProposal,
  representationProposalCsv,
  representationProposalMarkdown,
} from "@/lib/electrical-representation-proposal";

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function RepresentationProposalPanel() {
  const proposal = useMemo(() => representationProposal(), []);

  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">
        {REPRESENTATION_FIXTURE_IDS.join(" and ")} each hold two simultaneously correct statements:
        a canonical nominal/design supply voltage and an equipment nameplate rated voltage, each with
        its own VA arithmetic. The nameplate-basis figures (6600 VA, 1012 VA) are a different
        calculation basis, not corrections to the canonical 7200 VA and 1056 VA. Read-only: the
        canonical ODS is not modified, the FarmOps scalar columns are not overwritten, and there is
        no apply path.
      </p>

      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">{proposal.counts.fixtures} loads</Badge>
        <Badge variant="outline">{proposal.counts.rows} concept rows</Badge>
        <Badge variant="secondary">
          {proposal.counts.reclassified_pairs} findings leave Category B
        </Badge>
        <Badge variant="outline">
          {proposal.counts.retained_disagreements} disagreements retained
        </Badge>
        <Badge variant="outline">Read-only</Badge>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            download(
              "fs034-fs092-representation-proposal.csv",
              representationProposalCsv(proposal),
              "text/csv",
            )
          }
        >
          <Download className="mr-1 h-4 w-4" /> Representation CSV
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            download(
              "fs034-fs092-representation-proposal.md",
              representationProposalMarkdown(proposal),
              "text/markdown",
            )
          }
        >
          <Download className="mr-1 h-4 w-4" /> Representation Markdown
        </Button>
      </div>

      <ul className="space-y-1 text-xs text-muted-foreground">
        {REPRESENTATION_CONCEPTS.map((c) => (
          <li key={c}>
            <span className="font-mono">{c}</span> — {REPRESENTATION_CONCEPT_LABELS[c]}
          </li>
        ))}
      </ul>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1400px] text-xs">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="p-2">Stable ID</th>
              <th className="p-2">Concept</th>
              <th className="p-2">Canonical / design</th>
              <th className="p-2">Equipment / nameplate</th>
              <th className="p-2">FarmOps legacy</th>
              <th className="p-2">Calculation basis</th>
              <th className="p-2">Proposed representation</th>
              <th className="p-2">Disposition</th>
              <th className="p-2">Provenance</th>
            </tr>
          </thead>
          <tbody>
            {proposal.rows.map((r) => (
              <tr key={`${r.stable_id}-${r.concept}`} className="border-t border-border align-top">
                <td className="p-2">
                  <span className="font-mono">{r.stable_id}</span>
                  <div className="text-muted-foreground">{r.description}</div>
                </td>
                <td className="p-2 font-mono">{r.concept}</td>
                <td className="p-2">{r.canonical_value}</td>
                <td className="p-2">{r.nameplate_value}</td>
                <td className="p-2 text-muted-foreground">{r.farmops_legacy_value}</td>
                <td className="p-2">
                  {r.calculation_basis}
                  {r.va_basis ? (
                    <div className="mt-1">
                      <Badge variant="secondary">{r.va_basis}</Badge>
                      <div className="text-muted-foreground">{VA_BASIS_LABELS[r.va_basis]}</div>
                    </div>
                  ) : null}
                </td>
                <td className="p-2">{r.proposed_representation}</td>
                <td className="p-2">
                  <Badge
                    variant={
                      r.disposition === "ENGINEERING_DISAGREEMENT_RETAINED" ? "destructive" : "outline"
                    }
                  >
                    {r.disposition}
                  </Badge>
                  <div className="mt-1 text-muted-foreground">
                    {REPRESENTATION_DISPOSITION_LABELS[r.disposition]}
                  </div>
                </td>
                <td className="p-2 text-muted-foreground">
                  <ul className="list-disc space-y-1 pl-4">
                    {r.provenance.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-md border p-3">
        <p className="text-sm font-medium">Reclassified numeric findings</p>
        <p className="pt-1 text-xs text-muted-foreground">
          With both representations available these stop being Category-B engineering disagreements
          and are reported as Category F — semantic representation differences with both source
          values preserved.
        </p>
        <ul className="mt-2 space-y-2 text-xs">
          {proposal.pairs.map((p) => (
            <li key={`${p.stable_id}-${p.farmops_field}`}>
              <span className="font-mono">
                {p.stable_id} {p.farmops_entity}.{p.farmops_field}
              </span>{" "}
              — {p.ods_value} (canonical) vs {p.farmops_value} (FarmOps){" "}
              <Badge variant="outline">{p.disposition}</Badge>
              <div className="text-muted-foreground">{p.explanation}</div>
              <div className="text-muted-foreground">Proposed: {p.proposed_representation}</div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
