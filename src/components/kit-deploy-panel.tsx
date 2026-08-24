// Check-out / check-in panel for a kit (an inventory item with a parts list).
// Example: check out 1 x "Ham Radio Field Deployment Kit" labelled
// "Field Day 2026" -> 1 FT-891, 1 antenna, 2 batteries and 4 PL-259s leave
// stock. Check it back in when the truck comes home and stock is restored.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, PackageCheck, PackageOpen } from "lucide-react";
import {
  checkInKit,
  checkOutKit,
  listKitDeployments,
} from "@/lib/kit-deploy.functions";
import { outstanding, outstandingTotal, type Deployment } from "@/lib/kit-deploy";
import { formatQty } from "@/lib/inventory-bom";

export function KitDeployPanel({
  kitItemId,
  hasParts,
}: {
  kitItemId: string;
  hasParts: boolean;
}) {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listKitDeployments);
  const outFn = useServerFn(checkOutKit);
  const inFn = useServerFn(checkInKit);

  const [units, setUnits] = useState("1");
  const [label, setLabel] = useState("");
  const [partial, setPartial] = useState<Record<string, string>>({});

  const deploymentsQuery = useQuery({
    queryKey: ["kit-deployments", kitItemId],
    queryFn: () => listFn({ data: { kitItemId } }),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["kit-deployments", kitItemId] });
    queryClient.invalidateQueries({ queryKey: ["inventory-bom", kitItemId] });
    queryClient.invalidateQueries({ queryKey: ["inventory-items"] });
    queryClient.invalidateQueries({ queryKey: ["inventory"] });
  };

  const checkout = useMutation({
    mutationFn: (allowShort: boolean) =>
      outFn({
        data: {
          kitItemId,
          units: Number(units) || 1,
          label: label.trim() || undefined,
          allowShort,
        },
      }),
    onSuccess: (r) => {
      setLabel("");
      invalidate();
      toast.success(
        `Checked out — ${r.lines} part line${r.lines === 1 ? "" : "s"} pulled from stock`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const checkin = useMutation({
    mutationFn: (v: { deploymentId: string; lines?: Array<{ lineId: string; quantity: number }> }) =>
      inFn({ data: v }),
    onSuccess: (r) => {
      setPartial({});
      invalidate();
      toast.success(r.complete ? "Kit checked in — stock restored" : "Partial return recorded");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const shortMessage = useMemo(() => {
    const e = checkout.error as Error | null;
    return e && /Not enough stock/i.test(e.message) ? e.message : null;
  }, [checkout.error]);

  const open = (deploymentsQuery.data ?? []).filter((d) => d.status === "open");
  const past = (deploymentsQuery.data ?? []).filter((d) => d.status === "returned");

  return (
    <div className="rounded-md border p-3 space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <PackageOpen className="h-4 w-4" /> Deploy this kit
      </div>

      {!hasParts ? (
        <p className="text-xs text-muted-foreground">
          Add the kit contents above first — checking out pulls those parts from stock.
        </p>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-[90px_minmax(0,1fr)_auto]">
            <Input
              type="number"
              min="1"
              step="any"
              value={units}
              onChange={(e) => setUnits(e.target.value)}
              placeholder="Kits"
            />
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label — e.g. 'Field Day 2026' or 'Winter Field Day POTA'"
            />
            <Button
              onClick={() => checkout.mutate(false)}
              disabled={checkout.isPending || !(Number(units) > 0)}
            >
              {checkout.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Check out"
              )}
            </Button>
          </div>

          {shortMessage ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-2 text-xs space-y-2">
              <div>{shortMessage}</div>
              <Button size="sm" variant="outline" onClick={() => checkout.mutate(true)}>
                Check out anyway (stock may go negative)
              </Button>
            </div>
          ) : null}
        </>
      )}

      {deploymentsQuery.isLoading ? (
        <p className="text-xs text-muted-foreground">Loading deployments…</p>
      ) : null}

      {open.length > 0 ? (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">In the field</div>
          {open.map((d) => (
            <OpenDeployment
              key={d.id}
              deployment={d}
              partial={partial}
              setPartial={setPartial}
              busy={checkin.isPending}
              onReturnAll={() => checkin.mutate({ deploymentId: d.id })}
              onReturnPartial={(lines) => checkin.mutate({ deploymentId: d.id, lines })}
            />
          ))}
        </div>
      ) : null}

      {past.length > 0 ? (
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">Returned</div>
          <ul className="text-xs space-y-1">
            {past.slice(0, 10).map((d) => (
              <li key={d.id} className="flex justify-between gap-2">
                <span>
                  {d.label || "Deployment"} · ×{d.units}
                </span>
                <span className="text-muted-foreground">
                  {new Date(d.checkedOutAt).toLocaleDateString()} →{" "}
                  {d.returnedAt ? new Date(d.returnedAt).toLocaleDateString() : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function OpenDeployment({
  deployment,
  partial,
  setPartial,
  busy,
  onReturnAll,
  onReturnPartial,
}: {
  deployment: Deployment;
  partial: Record<string, string>;
  setPartial: (v: Record<string, string>) => void;
  busy: boolean;
  onReturnAll: () => void;
  onReturnPartial: (lines: Array<{ lineId: string; quantity: number }>) => void;
}) {
  const [showPartial, setShowPartial] = useState(false);
  const lines = deployment.lines.filter((l) => outstanding(l) > 0);

  return (
    <div className="rounded-md border p-2 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <span className="font-medium">{deployment.label || "Deployment"}</span>{" "}
          <Badge variant="outline">×{deployment.units}</Badge>{" "}
          <span className="text-xs text-muted-foreground">
            out {new Date(deployment.checkedOutAt).toLocaleDateString()} ·{" "}
            {outstandingTotal(deployment)} part units in field
          </span>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowPartial((s) => !s)}>
            Partial
          </Button>
          <Button size="sm" onClick={onReturnAll} disabled={busy}>
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <PackageCheck className="h-4 w-4 mr-1" /> Check in all
              </>
            )}
          </Button>
        </div>
      </div>

      <ul className="text-xs space-y-1">
        {lines.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-2">
            <span>{l.name}</span>
            <span className="flex items-center gap-2 text-muted-foreground">
              out {formatQty(l.quantityOut, l.unit)}
              {l.quantityReturned > 0 ? ` · back ${l.quantityReturned}` : ""}
              {showPartial ? (
                <Input
                  type="number"
                  min="0"
                  max={outstanding(l)}
                  step="any"
                  className="h-7 w-20"
                  placeholder={String(outstanding(l))}
                  value={partial[l.id] ?? ""}
                  onChange={(e) => setPartial({ ...partial, [l.id]: e.target.value })}
                />
              ) : null}
            </span>
          </li>
        ))}
      </ul>

      {showPartial ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() =>
            onReturnPartial(
              lines
                .map((l) => ({ lineId: l.id, quantity: Number(partial[l.id] ?? 0) }))
                .filter((l) => l.quantity > 0),
            )
          }
        >
          Record partial return
        </Button>
      ) : null}
    </div>
  );
}
