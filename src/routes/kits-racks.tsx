// Every kit and rack build-out on the place, in one list, with a picture of how
// each rack is stacked (bottom space at the bottom, just like the real rack).
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppLayout } from "@/components/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Boxes, Server, AlertTriangle, ArrowLeft } from "lucide-react";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { listKitRackBuildouts, type KitRackBuildout } from "@/lib/kit-rack-index.functions";
import { buildRackElevation, formatSpan } from "@/lib/rack-elevation";

export const Route = createFileRoute("/kits-racks")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({
    meta: [
      { title: "Kits & rack build-outs — Bostead Farms" },
      {
        name: "description",
        content:
          "Every inventory kit and equipment rack build-out, with the parts list and rack elevation for each.",
      },
      { property: "og:title", content: "Kits & rack build-outs — Bostead Farms" },
      {
        property: "og:description",
        content: "Kit parts lists and rack elevations recorded for the farm's equipment.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: KitsRacksPage,
});

const U_PX = 26;

/** Bottom-up picture of a rack, drawn only from recorded sizes and positions. */
function ElevationPreview({ buildout }: { buildout: KitRackBuildout }) {
  const sizeU = buildout.rack?.sizeU ?? null;
  const elevation = buildRackElevation(
    buildout.parts.map((p) => ({
      id: p.id,
      name: p.name,
      rackUnits: p.rackUnits,
      positionU: p.positionU,
      quantity: p.quantity,
    })),
    sizeU,
  );

  if (sizeU == null) {
    return (
      <p className="text-xs text-muted-foreground">
        No rack height recorded, so the stack can't be drawn.
      </p>
    );
  }

  const blocks: React.ReactElement[] = [];
  let u = sizeU;
  while (u >= 1) {
    const part = elevation.placed.find((p) => p.topU === u);
    if (part) {
      blocks.push(
        <div
          key={`p${part.id}`}
          className="flex items-center justify-between gap-2 border-b border-border/60 bg-card px-2 text-xs"
          style={{ height: part.rackUnits * U_PX }}
        >
          <span className="truncate font-medium">{part.name}</span>
          <span className="shrink-0 text-muted-foreground">{formatSpan(part)}</span>
        </div>,
      );
      u -= part.rackUnits;
      continue;
    }
    blocks.push(
      <div
        key={`e${u}`}
        className="flex items-center border-b border-dashed border-border/40 px-2 text-[11px] text-muted-foreground"
        style={{ height: U_PX }}
      >
        U{u}
      </div>,
    );
    u -= 1;
  }

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-md border-x-4 border-y border-border bg-muted/40">
        {blocks}
      </div>
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">
          {elevation.usedU} of {sizeU} spaces used
        </Badge>
        {elevation.unplaced.length > 0 ? (
          <Badge variant="secondary">{elevation.unplaced.length} part(s) not placed</Badge>
        ) : null}
      </div>
      {(elevation.conflicts.length > 0 || elevation.overflow.length > 0) && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs">
          <div className="flex items-center gap-1 font-medium text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            Check these positions
          </div>
          <ul className="mt-1 list-disc pl-5 text-muted-foreground">
            {elevation.conflicts.map((c, i) => (
              <li key={`c${i}`}>
                {c.a} and {c.b} both claim U{c.spaces.join(", U")}
              </li>
            ))}
            {elevation.overflow.map((o) => (
              <li key={o.id}>
                {o.name} at {formatSpan(o)} runs past the top of the rack
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function BuildoutCard({ buildout }: { buildout: KitRackBuildout }) {
  const isRack = Boolean(buildout.rack);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {isRack ? <Server className="h-4 w-4" /> : <Boxes className="h-4 w-4" />}
          {buildout.rack?.stableId || buildout.kitName}
          <Badge variant={isRack ? "default" : "secondary"}>
            {isRack ? "Rack build-out" : "Kit"}
          </Badge>
          <Badge variant="outline">
            {buildout.parts.length} {buildout.parts.length === 1 ? "part" : "parts"}
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {isRack ? `${buildout.kitName} · ` : ""}
          {buildout.rack?.description || buildout.location || "No location recorded"}
        </p>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {isRack ? <ElevationPreview buildout={buildout} /> : null}

        {buildout.parts.length === 0 ? (
          <p className="text-muted-foreground">
            No parts listed yet — add its contents to see them here.
          </p>
        ) : (
          <ul className="divide-y divide-border/60 text-xs">
            {buildout.parts.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 py-1">
                <span className="truncate">{p.name}</span>
                <span className="shrink-0 text-muted-foreground">
                  {p.quantity}
                  {p.unit ? ` ${p.unit}` : ""}
                  {p.rackUnits != null ? ` · ${p.rackUnits}U` : ""}
                  {p.positionU != null ? ` @ U${p.positionU}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}

        {isRack && buildout.rack ? (
          <Button size="sm" variant="outline" asChild>
            <Link to="/electrical/item/$kind/$id" params={{ kind: "rack", id: buildout.rack.id }}>
              Open rack
            </Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function KitsRacksPage() {
  const fn = useServerFn(listKitRackBuildouts);
  const q = useQuery<KitRackBuildout[]>({
    queryKey: ["kit-rack-buildouts"],
    queryFn: () => fn(),
  });

  const racks = (q.data ?? []).filter((b) => b.rack);
  const kits = (q.data ?? []).filter((b) => !b.rack);

  return (
    <AppLayout>
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold">Kits &amp; rack build-outs</h1>
            <p className="text-sm text-muted-foreground">
              Every kit in inventory, and every equipment rack built out by one.
            </p>
          </div>
          <Button size="sm" variant="outline" asChild>
            <Link to="/inventory">
              <ArrowLeft className="mr-1 h-4 w-4" /> Inventory
            </Link>
          </Button>
        </div>

        {q.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : q.error ? (
          <p className="text-destructive">{(q.error as Error).message}</p>
        ) : (q.data ?? []).length === 0 ? (
          <p className="text-muted-foreground">
            No kits recorded yet. Add an inventory item typed as a kit to start a build-out.
          </p>
        ) : (
          <>
            {racks.length > 0 ? (
              <section className="space-y-3">
                <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                  Rack build-outs ({racks.length})
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                  {racks.map((b) => (
                    <BuildoutCard key={b.kitId} buildout={b} />
                  ))}
                </div>
              </section>
            ) : null}

            {kits.length > 0 ? (
              <section className="space-y-3">
                <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                  Kits ({kits.length})
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                  {kits.map((b) => (
                    <BuildoutCard key={b.kitId} buildout={b} />
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>
    </AppLayout>
  );
}
