import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getFoodOverview, getFoodYieldProgress } from "@/lib/food.functions";
import { format } from "date-fns";
import { ChevronDown, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/food/")({
  component: FoodOverviewPage,
});

const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function fmtLbs(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n >= 100) return n.toFixed(0);
  if (n >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

function FoodOverviewPage() {
  const overviewFn = useServerFn(getFoodOverview);
  const yieldFn = useServerFn(getFoodYieldProgress);
  const q = useQuery({ queryKey: ["food", "overview"], queryFn: () => overviewFn() });
  const yq = useQuery({ queryKey: ["food", "yield-progress"], queryFn: () => yieldFn() });
  const data = q.data;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Production hub: plantings, herds, batches, and pantry stock. Use the
        sub-tabs above to drill in.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <StatCard label="Garden plantings" value={data?.garden_plantings ?? 0} to="/food/garden" />
        <StatCard label="Orchard trees" value={data?.orchard_trees ?? 0} to="/food/orchard" />
        <StatCard label="Livestock" value={data?.livestock_count ?? 0} to="/food/livestock" />
        <StatCard label="Recent harvests" value={data?.recent_harvests?.length ?? 0} to="/food/crops" />
      </div>

      <section>
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            Expected yield progress
          </h2>
          <span className="text-xs text-muted-foreground">
            Annual plan vs. logged harvests (lbs)
          </span>
        </div>
        {yq.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!yq.isLoading && (yq.data?.categories.length ?? 0) === 0 && (
          <p className="text-sm text-muted-foreground">
            No plan data yet — add foods and weekly quantities under{" "}
            <Link to="/food/plan" className="underline">Food Plan</Link>.
          </p>
        )}
        <div className="space-y-3">
          {(yq.data?.categories ?? []).map((cat) => (
            <CategoryBlock key={cat.category} cat={cat} />
          ))}
        </div>
      </section>

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

type Category = NonNullable<
  Awaited<ReturnType<typeof getFoodYieldProgress>>
>["categories"][number];

function ProgressBar({ progress }: { progress: number }) {
  const pct = Math.max(0, Math.min(1, progress)) * 100;
  const over = progress > 1;
  return (
    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
      <div
        className={over ? "h-full bg-emerald-500" : "h-full bg-primary"}
        style={{ width: `${over ? 100 : pct}%` }}
      />
    </div>
  );
}

function CategoryBlock({ cat }: { cat: Category }) {
  const [open, setOpen] = useState(false);
  const pct = cat.expected_pounds > 0 ? Math.round(cat.progress * 100) : 0;
  return (
    <div className="border border-border rounded-md bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-accent rounded-t-md"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-medium truncate">{cat.category}</span>
            <span className="text-xs font-mono text-muted-foreground shrink-0">
              {fmtLbs(cat.actual_pounds)} / {fmtLbs(cat.expected_pounds)} lbs
              {cat.expected_pounds > 0 && <> · {pct}%</>}
            </span>
          </div>
          <div className="mt-1.5">
            <ProgressBar progress={cat.progress} />
          </div>
        </div>
      </button>
      {open && (
        <ul className="divide-y divide-border border-t border-border">
          {cat.items.map((item) => (
            <FoodItemRow key={item.food_id} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FoodItemRow({ item }: { item: Category["items"][number] }) {
  const [open, setOpen] = useState(false);
  const pct = item.expected_pounds > 0 ? Math.round(item.progress * 100) : 0;
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-accent text-sm"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate">{item.name}</span>
            <span className="text-xs font-mono text-muted-foreground shrink-0">
              {fmtLbs(item.actual_pounds)} / {fmtLbs(item.expected_pounds)} lbs
              {item.expected_pounds > 0 && <> · {pct}%</>}
            </span>
          </div>
          <div className="mt-1.5">
            <ProgressBar progress={item.progress} />
          </div>
        </div>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 grid grid-cols-1 md:grid-cols-2 gap-4 bg-muted/30">
          <div>
            <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
              Plan entries ({item.plan_entries.length})
            </div>
            {item.plan_entries.length === 0 ? (
              <p className="text-xs text-muted-foreground">No plan entries.</p>
            ) : (
              <ul className="text-xs space-y-1">
                {item.plan_entries.map((e, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span>
                      {DAYS[e.day_of_week] ?? `Day ${e.day_of_week}`} · {e.person}
                    </span>
                    <span className="font-mono">{e.quantity}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
              Harvests ({item.harvest_entries.length})
            </div>
            {item.harvest_entries.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No harvests logged for this item yet.
              </p>
            ) : (
              <ul className="text-xs space-y-1">
                {item.harvest_entries.map((h) => (
                  <li key={h.id} className="flex justify-between gap-2">
                    <span className="font-mono">
                      {h.harvested_on ? format(new Date(h.harvested_on), "MMM d, yyyy") : "—"}
                    </span>
                    <span>
                      {h.quantity} {h.unit}{" "}
                      <span className="text-muted-foreground">({fmtLbs(h.pounds)} lbs)</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </li>
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
