// Phase 4.4c — canonical ODS correction-set manifest (read-only UI).
// No apply control: this view neither edits the workbook nor writes FarmOps.
import { Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  buildCanonicalCorrectionSet,
  canonicalCorrectionSetCsv,
  canonicalCorrectionSetMarkdown,
  CANONICAL_CORRECTION_SET_VERSION,
  type CanonicalCorrectionRow,
} from "@/lib/electrical-canonical-correction-set";
import type { AdjudicationBaseline } from "@/lib/electrical-adjudication-baseline";

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function Table({ rows, withheld }: { rows: CanonicalCorrectionRow[]; withheld: boolean }) {
  if (!rows.length)
    return (
      <p className="mt-2 rounded-md border border-dashed p-2 text-xs text-muted-foreground">
        None for the attached workbook.
      </p>
    );
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="py-1 pr-3">Stable ID</th>
            <th className="py-1 pr-3">Worksheet · row</th>
            <th className="py-1 pr-3">Field</th>
            <th className="py-1 pr-3">Old raw value</th>
            <th className="py-1 pr-3">Proposed value</th>
            <th className="py-1 pr-3">Evidence</th>
            <th className="py-1 pr-3">Adjudication</th>
            <th className="py-1 pr-3">Confidence</th>
            <th className="py-1 pr-3">Baseline SHA-256</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.stable_id}|${r.field}`} className="border-t align-top">
              <td className="py-1 pr-3 font-mono">{r.stable_id}</td>
              <td className="py-1 pr-3">
                {r.worksheet ?? "not parsed"} row {r.row ?? "?"}
              </td>
              <td className="py-1 pr-3 font-mono">{r.field}</td>
              <td className="py-1 pr-3">
                {r.old_raw_value ?? "not stated"} {r.unit}
              </td>
              <td className="py-1 pr-3">
                {r.proposed_value === null ? (
                  <span className="text-muted-foreground">none proposed</span>
                ) : (
                  `${r.proposed_value} ${r.unit}`
                )}
              </td>
              <td className="py-1 pr-3">
                <ul className="list-disc space-y-0.5 pl-4">
                  {r.evidence.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
                {withheld && r.withheld_reason ? (
                  <p className="pt-1 text-muted-foreground">Withheld: {r.withheld_reason}</p>
                ) : null}
              </td>
              <td className="py-1 pr-3">
                <Badge variant="outline">{r.adjudication}</Badge>
              </td>
              <td className="py-1 pr-3">{r.confidence}</td>
              <td className="py-1 pr-3 break-all font-mono">{r.baseline_sha256}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CanonicalCorrectionSetPanel({ baseline }: { baseline: AdjudicationBaseline }) {
  const set = buildCanonicalCorrectionSet(baseline);

  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="max-w-3xl">
          <p className="text-sm font-medium">
            Canonical correction-set manifest{" "}
            <span className="text-xs font-normal text-muted-foreground">
              manifest only — no ODS edit, no FarmOps write, no Phase 4.5 authorization
            </span>
          </p>
          <p className="pt-1 text-xs text-muted-foreground">
            Changes sufficiently proven to be made in the <em>next</em> revision of{" "}
            <code>{set.workbook_name}</code>. Old raw values are read from the attached SHA-verified
            workbook. FS-082 / FS-083 Amps, FS-084 Amps and FS-084 connected VA are explicitly
            withheld while legacy current semantics remain unresolved — no replacement value and no
            blanking is proposed for them. Manifest{" "}
            <code>{CANONICAL_CORRECTION_SET_VERSION}</code>.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              download(
                "phase-4.4c-canonical-correction-set.csv",
                canonicalCorrectionSetCsv(set),
                "text/csv",
              )
            }
          >
            <Download className="mr-1 h-3 w-3" /> Manifest CSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              download(
                "phase-4.4c-canonical-correction-set.md",
                canonicalCorrectionSetMarkdown(set),
                "text/markdown",
              )
            }
          >
            <Download className="mr-1 h-3 w-3" /> Manifest MD
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 pt-3 text-xs">
        <Badge variant="outline">
          Approved canonical correction candidates ={" "}
          {set.headline.approved_canonical_correction_candidates}
        </Badge>
        <Badge variant="outline">
          Withheld unresolved candidates = {set.headline.withheld_unresolved_candidates}
        </Badge>
        <Badge variant="secondary">
          Current baseline modified = {set.headline.current_baseline_modified}
        </Badge>
        <Badge variant="secondary">ODS edits 0</Badge>
        <Badge variant="secondary">FarmOps writes 0</Badge>
      </div>

      <p className="pt-3 text-sm font-medium">Approved candidates</p>
      <Table rows={set.approved} withheld={false} />

      <p className="pt-3 text-sm font-medium">
        Withheld corrections — investigated, not sufficiently established
      </p>
      <Table rows={set.withheld} withheld />
    </div>
  );
}
