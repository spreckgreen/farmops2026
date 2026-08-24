// Pack-out checklist for an open kit deployment.
// Example: before leaving for "Field Day 2026" you tick off 1 FT-891,
// 1 end-fed antenna, 2 LiFePO4 batteries and 4 PL-259 connectors — and record
// per-component issues such as "shortage: only 3 of 4 PL-259s in the bin" or
// "substitution: used the 100Ah battery instead of the 50Ah".
// State is remembered per deployment in localStorage so closing the dialog
// (or reloading on the truck) doesn't lose your progress.
import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ClipboardCheck, Printer, AlertTriangle, MessageSquarePlus } from "lucide-react";
import { type Deployment } from "@/lib/kit-deploy";
import { formatQty } from "@/lib/inventory-bom";

/** Why a component isn't simply "packed as specified". */
export const ISSUE_REASONS = [
  { value: "", label: "No issue" },
  { value: "shortage", label: "Shortage — fewer on hand than required" },
  { value: "missing", label: "Missing — not found at all" },
  { value: "defect", label: "Defect — damaged or not working" },
  { value: "substitution", label: "Substitution — packed a different part" },
  { value: "expired", label: "Expired / out of calibration" },
  { value: "other", label: "Other (see note)" },
] as const;

type IssueReason = (typeof ISSUE_REASONS)[number]["value"];

interface LineState {
  packed: boolean;
  issue: IssueReason;
  note: string;
}

const emptyLine: LineState = { packed: false, issue: "", note: "" };
const storageKey = (deploymentId: string) => `kit-checklist:${deploymentId}`;

function issueLabel(issue: IssueReason): string {
  return ISSUE_REASONS.find((r) => r.value === issue)?.label ?? issue;
}

/** Read saved state, migrating the older `{ [lineId]: boolean }` shape. */
function loadState(deploymentId: string): Record<string, LineState> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey(deploymentId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, boolean | Partial<LineState>>;
    const out: Record<string, LineState> = {};
    for (const [id, v] of Object.entries(parsed ?? {})) {
      if (typeof v === "boolean") out[id] = { ...emptyLine, packed: v };
      else
        out[id] = {
          packed: Boolean(v?.packed),
          issue: (v?.issue ?? "") as IssueReason,
          note: String(v?.note ?? ""),
        };
    }
    return out;
  } catch {
    return {};
  }
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function KitChecklistDialog({
  deployment,
  kitName,
}: {
  deployment: Deployment;
  kitName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<Record<string, LineState>>({});
  /** Line ids whose note/issue editor is expanded. */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Read storage after mount so SSR and hydration agree.
  useEffect(() => {
    if (open) {
      const loaded = loadState(deployment.id);
      setState(loaded);
      // Keep rows with an existing issue/note open so they're visible at a glance.
      setExpanded(
        new Set(
          Object.entries(loaded)
            .filter(([, v]) => v.issue || v.note)
            .map(([id]) => id),
        ),
      );
    }
  }, [open, deployment.id]);

  const persist = (next: Record<string, LineState>) => {
    setState(next);
    try {
      window.localStorage.setItem(storageKey(deployment.id), JSON.stringify(next));
    } catch {
      /* private mode / quota — checklist stays in-memory */
    }
  };

  const lineState = (id: string): LineState => state[id] ?? emptyLine;
  const setLine = (id: string, patch: Partial<LineState>) =>
    persist({ ...state, [id]: { ...lineState(id), ...patch } });

  const lines = deployment.lines;
  const doneCount = useMemo(() => lines.filter((l) => lineState(l.id).packed).length, [lines, state]);
  const issueLines = useMemo(
    () => lines.filter((l) => lineState(l.id).issue || lineState(l.id).note.trim()),
    [lines, state],
  );
  const pct = lines.length === 0 ? 0 : Math.round((doneCount / lines.length) * 100);
  const allPacked = lines.length > 0 && doneCount === lines.length;

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const checkAll = () =>
    persist(
      Object.fromEntries(
        lines.map((l) => [l.id, { ...lineState(l.id), packed: true }]),
      ),
    );
  /** Clears ticks but keeps issue reasons and notes — they're field evidence. */
  const clearTicks = () =>
    persist(
      Object.fromEntries(
        lines.map((l) => [l.id, { ...lineState(l.id), packed: false }]),
      ),
    );

  const title = `${kitName ? `${kitName} — ` : ""}${deployment.label || "Deployment"}`;

  const print = () => {
    const rows = lines
      .map((l) => {
        const s = lineState(l.id);
        const issue = [s.issue ? issueLabel(s.issue) : "", s.note]
          .filter(Boolean)
          .join(" — ");
        return (
          `<tr><td style="padding:4px 8px">${s.packed ? "[x]" : "[ ]"}</td>` +
          `<td style="padding:4px 8px">${escapeHtml(l.name)}</td>` +
          `<td style="padding:4px 8px">${escapeHtml(formatQty(l.quantityOut, l.unit))}</td>` +
          `<td style="padding:4px 8px">${escapeHtml(issue)}</td></tr>`
        );
      })
      .join("");
    const html =
      `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>` +
      `<body style="font-family:system-ui,sans-serif"><h1 style="font-size:18px">${escapeHtml(title)}</h1>` +
      `<p style="font-size:12px">Packed ${doneCount} of ${lines.length} · ${issueLines.length} issue(s) · checked out ` +
      `${new Date(deployment.checkedOutAt).toLocaleString()}</p>` +
      `<table style="border-collapse:collapse;font-size:13px">` +
      `<tr><th style="text-align:left;padding:4px 8px">✓</th><th style="text-align:left;padding:4px 8px">Component</th>` +
      `<th style="text-align:left;padding:4px 8px">Qty</th><th style="text-align:left;padding:4px 8px">Issue / note</th></tr>` +
      `${rows}</table></body></html>`;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <ClipboardCheck className="h-4 w-4 mr-1" /> Checklist
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {title}
            {allPacked ? <Badge>Ready</Badge> : null}
            {issueLines.length > 0 ? (
              <Badge variant="destructive">
                {issueLines.length} issue{issueLines.length === 1 ? "" : "s"}
              </Badge>
            ) : null}
          </DialogTitle>
          <DialogDescription>
            Tick every component as it goes in the truck, and record shortages, defects, or
            substitutions per line. Saved on this device.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Progress value={pct} className="h-2" />
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {doneCount}/{lines.length}
            </span>
          </div>

          <ul className="divide-y rounded-md border">
            {lines.map((l) => {
              const s = lineState(l.id);
              const isOpen = expanded.has(l.id);
              return (
                <li key={l.id} className="px-3 py-2 space-y-2">
                  <div className="flex items-center gap-3">
                    <Checkbox
                      id={`chk-${l.id}`}
                      checked={s.packed}
                      onCheckedChange={() => setLine(l.id, { packed: !s.packed })}
                    />
                    <label
                      htmlFor={`chk-${l.id}`}
                      className={`flex-1 text-sm cursor-pointer ${
                        s.packed ? "line-through text-muted-foreground" : ""
                      }`}
                    >
                      {l.name}
                      {s.issue ? (
                        <Badge variant="destructive" className="ml-2 align-middle">
                          {s.issue}
                        </Badge>
                      ) : null}
                    </label>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatQty(l.quantityOut, l.unit)}
                      {l.quantityReturned > 0 ? ` · back ${l.quantityReturned}` : ""}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      aria-label={`Note or issue for ${l.name}`}
                      onClick={() => toggleExpanded(l.id)}
                    >
                      {s.issue ? (
                        <AlertTriangle className="h-4 w-4 text-destructive" />
                      ) : (
                        <MessageSquarePlus className="h-4 w-4" />
                      )}
                    </Button>
                  </div>

                  {isOpen ? (
                    <div className="pl-7 space-y-2">
                      <select
                        value={s.issue}
                        onChange={(e) =>
                          setLine(l.id, { issue: e.target.value as IssueReason })
                        }
                        aria-label={`Issue reason for ${l.name}`}
                        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                      >
                        {ISSUE_REASONS.map((r) => (
                          <option key={r.value || "none"} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                      <Input
                        value={s.note}
                        onChange={(e) => setLine(l.id, { note: e.target.value })}
                        placeholder="Pack-out note, e.g. only 3 of 4 on hand — packed 100Ah instead"
                        className="h-8 text-xs"
                        aria-label={`Note for ${l.name}`}
                      />
                      {s.issue || s.note ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs"
                          onClick={() => setLine(l.id, { issue: "", note: "" })}
                        >
                          Clear issue
                        </Button>
                      ) : null}
                    </div>
                  ) : s.note ? (
                    <p className="pl-7 text-xs text-muted-foreground">{s.note}</p>
                  ) : null}
                </li>
              );
            })}
            {lines.length === 0 ? (
              <li className="px-3 py-2 text-xs text-muted-foreground">
                This deployment has no component lines.
              </li>
            ) : null}
          </ul>

          {issueLines.length > 0 ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs space-y-1">
              <div className="font-medium flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-destructive" /> Issues to resolve before
                leaving
              </div>
              {issueLines.map((l) => {
                const s = lineState(l.id);
                return (
                  <div key={l.id} className="text-muted-foreground">
                    <span className="text-foreground">{l.name}</span>
                    {s.issue ? ` · ${issueLabel(s.issue)}` : ""}
                    {s.note ? ` · ${s.note}` : ""}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={checkAll}>
              Check all
            </Button>
            <Button size="sm" variant="ghost" onClick={clearTicks}>
              Clear ticks
            </Button>
          </div>
          <Button size="sm" variant="outline" onClick={print}>
            <Printer className="h-4 w-4 mr-1" /> Print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
