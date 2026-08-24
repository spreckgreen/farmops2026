// Pack-out checklist for an open kit deployment.
// Example: before leaving for "Field Day 2026" you tick off 1 FT-891,
// 1 end-fed antenna, 2 LiFePO4 batteries and 4 PL-259 connectors.
// Ticks are remembered per deployment in localStorage so closing the
// dialog (or reloading on the truck) doesn't lose your progress.
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
import { Progress } from "@/components/ui/progress";
import { ClipboardCheck, Printer } from "lucide-react";
import { type Deployment } from "@/lib/kit-deploy";
import { formatQty } from "@/lib/inventory-bom";

const storageKey = (deploymentId: string) => `kit-checklist:${deploymentId}`;

function loadChecked(deploymentId: string): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey(deploymentId));
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export function KitChecklistDialog({
  deployment,
  kitName,
}: {
  deployment: Deployment;
  kitName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  // Read storage after mount so SSR and hydration agree.
  useEffect(() => {
    if (open) setChecked(loadChecked(deployment.id));
  }, [open, deployment.id]);

  const persist = (next: Record<string, boolean>) => {
    setChecked(next);
    try {
      window.localStorage.setItem(storageKey(deployment.id), JSON.stringify(next));
    } catch {
      /* private mode / quota — checklist stays in-memory */
    }
  };

  const lines = deployment.lines;
  const doneCount = useMemo(
    () => lines.filter((l) => checked[l.id]).length,
    [lines, checked],
  );
  const pct = lines.length === 0 ? 0 : Math.round((doneCount / lines.length) * 100);
  const allPacked = lines.length > 0 && doneCount === lines.length;

  const toggle = (id: string) => persist({ ...checked, [id]: !checked[id] });
  const checkAll = () =>
    persist(Object.fromEntries(lines.map((l) => [l.id, true])));
  const clearAll = () => persist({});

  const title = `${kitName ? `${kitName} — ` : ""}${deployment.label || "Deployment"}`;

  const print = () => {
    const rows = lines
      .map(
        (l) =>
          `<tr><td style="padding:4px 8px">${checked[l.id] ? "[x]" : "[ ]"}</td>` +
          `<td style="padding:4px 8px">${l.name}</td>` +
          `<td style="padding:4px 8px">${formatQty(l.quantityOut, l.unit)}</td></tr>`,
      )
      .join("");
    const html =
      `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>` +
      `<body style="font-family:system-ui,sans-serif"><h1 style="font-size:18px">${title}</h1>` +
      `<p style="font-size:12px">Packed ${doneCount} of ${lines.length} · checked out ` +
      `${new Date(deployment.checkedOutAt).toLocaleString()}</p>` +
      `<table style="border-collapse:collapse;font-size:13px">${rows}</table></body></html>`;
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {title}
            {allPacked ? <Badge>Ready</Badge> : null}
          </DialogTitle>
          <DialogDescription>
            Tick every component as it goes in the truck. Progress is saved on this device.
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
            {lines.map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-3 py-2">
                <Checkbox
                  id={`chk-${l.id}`}
                  checked={!!checked[l.id]}
                  onCheckedChange={() => toggle(l.id)}
                />
                <label
                  htmlFor={`chk-${l.id}`}
                  className={`flex-1 text-sm cursor-pointer ${
                    checked[l.id] ? "line-through text-muted-foreground" : ""
                  }`}
                >
                  {l.name}
                </label>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {formatQty(l.quantityOut, l.unit)}
                  {l.quantityReturned > 0 ? ` · back ${l.quantityReturned}` : ""}
                </span>
              </li>
            ))}
            {lines.length === 0 ? (
              <li className="px-3 py-2 text-xs text-muted-foreground">
                This deployment has no component lines.
              </li>
            ) : null}
          </ul>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={checkAll}>
              Check all
            </Button>
            <Button size="sm" variant="ghost" onClick={clearAll}>
              Clear
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
