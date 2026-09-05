// Phase 4.4 — attach the SHA-verified canonical workbook to load adjudication.
//
// Adjudication has no stored copy of the canonical values. The owner selects the
// same .ods Parallel Validation uses; the server parses and hashes it in memory
// and returns the canonical load rows with their worksheet/row provenance.
import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileCheck2, ShieldCheck, ShieldX } from "lucide-react";
import { toast } from "sonner";

import { NOT_RECORDED, isRecordedNumber } from "@/lib/electrical-current-display";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buildAdjudicationBaseline } from "@/lib/electrical-adjudication-baseline.functions";
import { useCanonicalWorkbookSession } from "@/hooks/use-canonical-workbook-session";
import {
  clearCanonicalWorkbookSession,
  setCanonicalWorkbookSession,
} from "@/lib/electrical-canonical-workbook-session";
import {
  PHASE_44A_BASELINE_ODS_FILE,
  PHASE_44A_BASELINE_SHA256,
  type AdjudicationBaseline,
} from "@/lib/electrical-adjudication-baseline";

export interface AttachedBaseline {
  file_name: string;
  base64: string;
  baseline: AdjudicationBaseline;
}

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function AdjudicationBaselinePicker({
  attached,
  onAttach,
}: {
  attached: AttachedBaseline | null;
  onAttach: (b: AttachedBaseline | null) => void;
}) {
  const build = useServerFn(buildAdjudicationBaseline);
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const { availability } = useCanonicalWorkbookSession();

  const mutation = useMutation({
    mutationFn: async (source: { file_name: string; base64: string }) => {
      const baseline = (await build({
        data: { file_name: source.file_name, base64: source.base64 },
      })) as unknown as AdjudicationBaseline;
      return { file_name: source.file_name, base64: source.base64, baseline } satisfies AttachedBaseline;
    },
    onSuccess: (b) => {
      onAttach(b);
      // Keep one shared session across electrical routes.
      setCanonicalWorkbookSession({
        file_name: b.file_name,
        base64: b.base64,
        sha256: b.baseline.ods_sha256,
        parsed_at: b.baseline.parsed_at,
        established_by: "load_adjudication",
      });
      if (b.baseline.is_phase_44a_baseline) {
        toast.success(
          `Canonical baseline attached: ${b.baseline.loads.length} adjudicated load(s) parsed.`,
        );
      } else {
        toast.warning("That workbook is not the confirmed Phase 4.4a baseline. Apply is blocked.");
      }
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setPending(false),
  });

  // Adopt the workbook Parallel validation already validated in this tab. No
  // hard-coded canonical values are ever substituted: without bytes we ask for
  // a reattach instead.
  useEffect(() => {
    if (attached || pending || mutation.isPending) return;
    if (availability.state !== "available") return;
    setPending(true);
    mutation.mutate({ file_name: availability.meta.file_name, base64: availability.base64 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attached, availability.state, pending]);

  const b = attached?.baseline ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileCheck2 className="h-4 w-4" /> Canonical ODS baseline
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Adjudication keeps no copy of the canonical workbook. Select the same{" "}
          <code>{PHASE_44A_BASELINE_ODS_FILE}</code> used by Parallel validation; it is parsed and
          hashed in memory (never written) and every canonical value below carries its worksheet, row
          and workbook SHA-256. Corrections are refused unless the attached workbook hashes to the
          authorized Phase 4.4a baseline{" "}
          <span className="break-all font-mono text-xs">{PHASE_44A_BASELINE_SHA256}</span>.
        </p>
        {!attached && availability.state === "reattach_required" ? (
          <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            <p className="font-medium">Canonical ODS baseline unavailable on this page</p>
            <p>
              <span className="font-mono">{availability.meta.file_name}</span> was validated in this
              session (SHA-256 <span className="break-all font-mono">{availability.meta.sha256}</span>
              {availability.meta.baseline_authorized ? " — AUTHORIZED" : " — not the authorized baseline"}
              ), but the workbook bytes are not retained across a page reload. Reattach the same file
              to adjudicate; stored or cached canonical values are never used instead.
            </p>
          </div>
        ) : null}
        {!attached && availability.state === "available" ? (
          <div className="rounded-md border p-3 text-xs">
            Using the Parallel validation baseline{" "}
            <span className="font-mono">{availability.meta.file_name}</span>{" "}
            <span className="break-all font-mono">{availability.meta.sha256}</span>{" "}
            {availability.meta.baseline_authorized ? "— AUTHORIZED." : "— not the authorized baseline."}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={input}
            type="file"
            accept=".ods,application/vnd.oasis.opendocument.spreadsheet"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setPending(true);
              void fileToBase64(file).then((base64) =>
                mutation.mutate({ file_name: file.name, base64 }),
              );
            }}
          />
          <Button size="sm" disabled={pending} onClick={() => input.current?.click()}>
            {pending ? "Parsing…" : attached ? "Replace workbook" : "Attach canonical .ods"}
          </Button>
          {attached ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onAttach(null);
                clearCanonicalWorkbookSession();
              }}
            >
              Detach
            </Button>
          ) : null}
        </div>

        {b ? (
          <div className="space-y-2 rounded-md border p-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="font-mono">
                {b.ods_file_name}
              </Badge>
              {b.is_phase_44a_baseline ? (
                <Badge className="gap-1">
                  <ShieldCheck className="h-3 w-3" /> Phase 4.4a baseline confirmed
                </Badge>
              ) : (
                <Badge variant="destructive" className="gap-1">
                  <ShieldX className="h-3 w-3" /> Not the Phase 4.4a baseline — apply blocked
                </Badge>
              )}
              <Badge variant="secondary">{b.loads.length} canonical load rows</Badge>
              {b.missing_load_ids.length ? (
                <Badge variant="destructive">
                  Not in workbook: {b.missing_load_ids.join(", ")}
                </Badge>
              ) : null}
            </div>
            <p className="break-all font-mono">SHA-256 {b.ods_sha256}</p>
            <p className="text-muted-foreground">
              Parsed {b.parsed_at} from worksheet(s){" "}
              {b.load_worksheets.join(", ") || "none classified as loads"}.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3">Load</th>
                    <th className="py-1 pr-3">Worksheet</th>
                    <th className="py-1 pr-3">Row</th>
                    <th className="py-1 pr-3">Volts</th>
                    <th className="py-1 pr-3">Amps</th>
                    <th className="py-1 pr-3">Connected VA</th>
                  </tr>
                </thead>
                <tbody>
                  {b.loads.map((l) => (
                    <tr key={l.stable_id} className="border-t">
                      <td className="py-1 pr-3 font-mono">{l.stable_id}</td>
                      <td className="py-1 pr-3">{l.worksheet}</td>
                      <td className="py-1 pr-3">{l.row}</td>
                      <td className="py-1 pr-3 font-mono">{l.volts ?? "not stated"}</td>
                      <td className="py-1 pr-3 font-mono">{isRecordedNumber(l.amps) ? l.amps : NOT_RECORDED}</td>
                      <td className="py-1 pr-3 font-mono">{isRecordedNumber(l.connected_va) ? l.connected_va : NOT_RECORDED}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            No canonical baseline attached. Findings are not computed and no correction may be
            applied — stored values are never substituted for the SHA-verified workbook.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
