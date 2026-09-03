// Shared Farm Shop grid-map card: used on the electrical overview and on the
// full-screen /electrical/grid-map page.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Maximize2, Map as MapIcon } from "lucide-react";
import { electricalGridMap } from "@/lib/electrical-grid-map.functions";
import { CLASS_ORDER, type CircuitClass } from "@/lib/electrical-grid-map";
import { FarmShopGridMap } from "@/components/electrical/farm-shop-grid-map";

export function GridMapPanel({ large = false }: { large?: boolean }) {
  const fetcher = useServerFn(electricalGridMap);
  const q = useQuery({ queryKey: ["electrical", "grid-map"], queryFn: () => fetcher() });
  const [panel, setPanel] = useState("ALL");
  const [visible, setVisible] = useState<Set<CircuitClass>>(new Set(CLASS_ORDER));

  const toggle = (k: CircuitClass) =>
    setVisible((cur) => {
      const next = new Set(cur);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <Card>
      <CardHeader className="pb-2 flex-row items-center justify-between gap-2">
        <CardTitle className="text-base flex items-center gap-2">
          <MapIcon className="h-4 w-4" />
          Farm Shop grid map
        </CardTitle>
        {large ? null : (
          <Button asChild size="sm" variant="outline" className="h-7 px-2 text-xs">
            <Link to="/electrical/grid-map">
              <Maximize2 className="h-3.5 w-3.5 mr-1" />
              Expand
            </Link>
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {q.isLoading ? (
          <Skeleton className="h-72 w-full" />
        ) : q.error ? (
          <p className="text-sm text-destructive">{(q.error as Error).message}</p>
        ) : (
          <>
            <FarmShopGridMap
              points={q.data!.points}
              panels={q.data!.panels}
              selectedPanel={panel}
              onSelectPanel={setPanel}
              visibleClasses={visible}
              onToggleClass={toggle}
              large={large}
            />
            {q.data!.gaps.length ? (
              <div className="space-y-1 rounded-md border border-border bg-muted/40 p-2">
                <p className="text-xs font-medium">Record gaps</p>
                {q.data!.gaps.map((g, i) => (
                  <p key={i} className="text-xs text-muted-foreground">
                    {g}
                  </p>
                ))}
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
