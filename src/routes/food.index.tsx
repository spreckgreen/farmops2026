import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getFoodOverview } from "@/lib/food.functions";
import { format } from "date-fns";

export const Route = createFileRoute("/food/")({
  component: FoodOverviewPage,
});

function FoodOverviewPage() {
  const fn = useServerFn(getFoodOverview);
  const q = useQuery({ queryKey: ["food", "overview"], queryFn: () => fn() });
  const data = q.data;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Production hub: plantings, herds, batches, and pantry stock. Use the
        sub-tabs above to drill in.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <StatCard
          label="Garden plantings"
          value={data?.garden_plantings ?? 0}
          to="/food/garden"
        />
        <StatCard
          label="Orchard trees"
          value={data?.orchard_trees ?? 0}
          to="/food/orchard"
        />
        <StatCard
          label="Livestock"
          value={data?.livestock_count ?? 0}
          to="/food/livestock"
        />
        <StatCard
          label="Recent harvests"
          value={data?.recent_harvests?.length ?? 0}
          to="/food/crops"
        />
      </div>

      <section>
        <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">
          Recent plantings
        </h2>
        {q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!q.isLoading && (data?.recent_plantings?.length ?? 0) === 0 && (
          <p className="text-sm text-muted-foreground">
            No plantings yet — add rows under Garden or Orchard.
          </p>
        )}
        <ul className="divide-y divide-border border border-border rounded-md">
          {(data?.recent_plantings ?? []).map((p) => (
            <li key={p.id} className="flex items-center justify-between px-3 py-2 text-sm gap-3">
              <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground w-20 shrink-0">
                {p.source}
              </span>
              <span className="flex-1 truncate">{p.name}</span>
              <span className="text-muted-foreground text-xs">{p.detail}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">
          Recent harvests
        </h2>
        {!q.isLoading && (data?.recent_harvests?.length ?? 0) === 0 && (
          <p className="text-sm text-muted-foreground">
            No harvests yet — log one under Crops.
          </p>
        )}
        <ul className="divide-y divide-border border border-border rounded-md">
          {(data?.recent_harvests ?? []).map((h) => (
            <li key={h.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="font-mono">{format(new Date(h.harvested_on), "MMM d")}</span>
              <span>
                {h.quantity} {h.unit}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function StatCard({ label, value, to }: { label: string; value: number; to: string }) {
  return (
    <Link
      to={to}
      className="border border-border rounded-md p-3 bg-card hover:bg-accent transition-colors"
    >
      <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="text-2xl font-mono font-semibold mt-1">{value}</div>
    </Link>
  );
}
