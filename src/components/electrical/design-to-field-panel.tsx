// FARMOPS-ELEC-DESIGN-TO-FIELD-V1 — two-step workspace with change history.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, MapPin, Ruler } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  acceptFieldEvidence,
  loadDesignToFieldWorkspace,
  submitApprovedDesign,
  type DesignToFieldPayload,
  type DesignToFieldRecord,
} from "@/lib/electrical-design-to-field.functions";
import { historyCsv, type StepPreview } from "@/lib/electrical-design-to-field";

const feet = (v: number | null) => (v === null ? "not recorded" : `${v} ft`);

export function DesignToFieldPanel() {
  const queryClient = useQueryClient();
  const loadWorkspace = useServerFn(loadDesignToFieldWorkspace);
  const submitDesign = useServerFn(submitApprovedDesign);
  const acceptField = useServerFn(acceptFieldEvidence);

  const workspace = useQuery<DesignToFieldPayload>({
    queryKey: ["electrical", "design-to-field"],
    queryFn: () => loadWorkspace({}) as Promise<DesignToFieldPayload>,
  });

  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string>("");
  const [designX, setDesignX] = useState("");
  const [designY, setDesignY] = useState("");
  const [approval, setApproval] = useState("");
  const [fieldX, setFieldX] = useState("");
  const [fieldY, setFieldY] = useState("");
  const [evidence, setEvidence] = useState("");
  const [preview, setPreview] = useState<StepPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const records = workspace.data?.records ?? [];
  const record: DesignToFieldRecord | null =
    records.find((r) => r.stableId === selected) ?? null;

  const visible = useMemo(() => {
    const q = filter.trim().toUpperCase();
    const rows = q
      ? records.filter(
          (r) =>
            r.stableId.includes(q) || (r.description ?? "").toUpperCase().includes(q),
        )
      : records;
    return rows.slice(0, 60);
  }, [records, filter]);

  const history = workspace.data?.history ?? [];
  const recordHistory = selected ? history.filter((h) => h.stableId === selected) : history;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["electrical", "design-to-field"] });
  };

  const step = useMutation({
    mutationFn: async (vars: {
      kind: "design" | "field";
      confirm: boolean;
    }): Promise<{ preview: StepPreview; applied: boolean }> => {
      const common = { stableId: selected, confirm: vars.confirm };
      if (vars.kind === "design") {
        return (await submitDesign({
          data: {
            ...common,
            xFt: Number.parseFloat(designX),
            yFt: Number.parseFloat(designY),
            reference: approval,
          },
        })) as { preview: StepPreview; applied: boolean };
      }
      return (await acceptField({
        data: {
          ...common,
          xFt: Number.parseFloat(fieldX),
          yFt: Number.parseFloat(fieldY),
          reference: evidence,
        },
      })) as { preview: StepPreview; applied: boolean };
    },
    onSuccess: (r) => {
      setPreview(r.preview);
      setError(null);
      if (r.applied) {
        toast.success(r.preview.effectiveAfter);
        refresh();
      } else if (!r.preview.changes.length) {
        toast.info("Nothing to change — the record already holds these values.");
      } else {
        toast.info("Review the exact before and after values, then record the step.");
      }
    },
    onError: (e) => {
      setPreview(null);
      setError(String(e instanceof Error ? e.message : e));
    },
  });

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Pick a record</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search by ID or description"
            />
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {workspace.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading records…</p>
              ) : null}
              {visible.map((r) => (
                <button
                  key={r.stableId}
                  type="button"
                  onClick={() => {
                    setSelected(r.stableId);
                    setPreview(null);
                    setError(null);
                    setDesignX(r.designXFt === null ? "" : String(r.designXFt));
                    setDesignY(r.designYFt === null ? "" : String(r.designYFt));
                    setFieldX(r.fieldXFt === null ? "" : String(r.fieldXFt));
                    setFieldY(r.fieldYFt === null ? "" : String(r.fieldYFt));
                  }}
                  className={`w-full rounded-md px-2 py-1 text-left text-xs ${
                    r.stableId === selected ? "bg-accent text-foreground" : "hover:bg-accent/60"
                  }`}
                >
                  <span className="font-mono">{r.stableId}</span>{" "}
                  <span className="text-muted-foreground">{r.description ?? ""}</span>
                  <span className="block text-muted-foreground">{r.provenance}</span>
                </button>
              ))}
              {!workspace.isLoading && !visible.length ? (
                <p className="text-sm text-muted-foreground">No matching record.</p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {record ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  <span className="font-mono">{record.stableId}</span>
                  <Badge variant="outline">{record.installStatus ?? "no lifecycle"}</Badge>
                  {record.needsAdjudication ? (
                    <Badge variant="destructive">Location conflict — adjudicate</Badge>
                  ) : null}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p className="text-muted-foreground">{record.provenance}</p>
                <p>
                  <span className="text-muted-foreground">Approved design: </span>
                  {feet(record.designXFt)} east / {feet(record.designYFt)} south
                  {record.designGrid ? ` · ${record.designGrid}` : ""}
                  {record.designApproval ? ` · ${record.designApproval}` : ""}
                </p>
                <p>
                  <span className="text-muted-foreground">Field evidence: </span>
                  {feet(record.fieldXFt)} east / {feet(record.fieldYFt)} south
                  {record.fieldGrid ? ` · ${record.fieldGrid}` : ""}
                  {record.fieldEvidence ? ` · ${record.fieldEvidence}` : ""}
                </p>
                {record.warnings.map((w) => (
                  <p key={w} className="text-muted-foreground">
                    {w}
                  </p>
                ))}
              </CardContent>
            </Card>
          ) : (
            <p className="text-sm text-muted-foreground">
              Choose a record to submit an approved design position or accept field evidence.
            </p>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Ruler className="h-4 w-4 text-primary" />
                  Step 1 — approved design position
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor="dx">Feet east</Label>
                    <Input id="dx" value={designX} onChange={(e) => setDesignX(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="dy">Feet south</Label>
                    <Input id="dy" value={designY} onChange={(e) => setDesignY(e.target.value)} />
                  </div>
                </div>
                <div>
                  <Label htmlFor="approval">Approved by / reference</Label>
                  <Input
                    id="approval"
                    value={approval}
                    onChange={(e) => setApproval(e.target.value)}
                    placeholder="Owner approval 05Sep26 — lighting layout"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!selected || step.isPending}
                    onClick={() => step.mutate({ kind: "design", confirm: false })}
                  >
                    Preview
                  </Button>
                  <Button
                    size="sm"
                    disabled={
                      !selected ||
                      step.isPending ||
                      preview?.step !== "APPROVED_DESIGN_SUBMITTED" ||
                      !preview?.changes.length
                    }
                    onClick={() => step.mutate({ kind: "design", confirm: true })}
                  >
                    Record design position
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  The position stays unverified and the lifecycle is untouched: an approved design
                  is not field evidence.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <MapPin className="h-4 w-4 text-primary" />
                  Step 2 — accept field evidence
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor="fx">Feet east as found</Label>
                    <Input id="fx" value={fieldX} onChange={(e) => setFieldX(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="fy">Feet south as found</Label>
                    <Input id="fy" value={fieldY} onChange={(e) => setFieldY(e.target.value)} />
                  </div>
                </div>
                <div>
                  <Label htmlFor="evidence">What was observed</Label>
                  <Textarea
                    id="evidence"
                    rows={2}
                    value={evidence}
                    onChange={(e) => setEvidence(e.target.value)}
                    placeholder="Field audit 05Sep26 — measured from the north-west corner"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!selected || step.isPending}
                    onClick={() => step.mutate({ kind: "field", confirm: false })}
                  >
                    Preview
                  </Button>
                  <Button
                    size="sm"
                    disabled={
                      !selected ||
                      step.isPending ||
                      preview?.step !== "FIELD_EVIDENCE_ACCEPTED" ||
                      !preview?.changes.length
                    }
                    onClick={() => step.mutate({ kind: "field", confirm: true })}
                  >
                    Accept field evidence
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Field evidence wins the derived location, and the approved design position is kept
                  for comparison.
                </p>
              </CardContent>
            </Card>
          </div>

          {preview ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {preview.step === "APPROVED_DESIGN_SUBMITTED"
                    ? "Design position preview"
                    : "Field evidence preview"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <p>
                  <span className="text-muted-foreground">Location now: </span>
                  {preview.effectiveBefore}
                </p>
                <p>
                  <span className="text-muted-foreground">Location after: </span>
                  {preview.effectiveAfter}
                </p>
                {preview.changes.length ? (
                  <ul className="space-y-0.5">
                    {preview.changes.map((c) => (
                      <li key={c.column} className="font-mono">
                        {c.column}: {c.before === null ? "not recorded" : String(c.before)} →{" "}
                        {c.after === null ? "not recorded" : String(c.after)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">Nothing would change.</p>
                )}
                <ul className="space-y-0.5 text-muted-foreground">
                  {preview.preserved.map((p) => (
                    <li key={p}>Kept: {p}</li>
                  ))}
                  {preview.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">
            Change history {selected ? `— ${selected}` : "— all records"}
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            disabled={!recordHistory.length}
            onClick={() => {
              const blob = new Blob([historyCsv(recordHistory)], { type: "text/csv" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "design-to-field-history.csv";
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Download className="mr-1 h-4 w-4" />
            History CSV
          </Button>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          {recordHistory.length ? (
            recordHistory.map((h) => (
              <div key={h.id} className="rounded-md border p-2">
                <p className="font-medium">
                  <span className="font-mono">{h.stableId}</span> ·{" "}
                  {h.step === "APPROVED_DESIGN_SUBMITTED"
                    ? "approved design position"
                    : h.step === "FIELD_EVIDENCE_ACCEPTED"
                      ? "field evidence accepted"
                      : "location change"}
                </p>
                <p className="text-muted-foreground">
                  {h.at ? new Date(h.at).toLocaleString() : ""}
                  {h.actor ? ` · ${h.actor}` : ""}
                </p>
                <p>{h.summary}</p>
                <ul className="mt-1 space-y-0.5 text-muted-foreground">
                  {h.changes.map((c) => (
                    <li key={c.column} className="font-mono">
                      {c.column}: {c.before === null ? "not recorded" : String(c.before)} →{" "}
                      {c.after === null ? "not recorded" : String(c.after)}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground">
              No design or field-evidence change has been recorded yet.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
