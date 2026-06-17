import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { getFoodOverview, getFoodYieldProgress } from "@/lib/food.functions";
import { fmtUsd } from "@/lib/currency";
import { kcalFromLbs, fmtKcal, DEFAULT_KCAL_PER_LB } from "@/lib/calories";
import { format } from "date-fns";
import { ChevronDown, ChevronRight } from "lucide-react";
import { FOOD_CATEGORIES } from "@/lib/food-categories";

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

function kcalTotal(lbs: number): string {
  return fmtKcal((lbs || 0) * DEFAULT_KCAL_PER_LB);
}

function KcalSpan({ name, lbs }: { name?: string | null; lbs: number }) {
  if (!lbs) return null;
  return (
    <span className="opacity-70"> ({fmtKcal(kcalFromLbs(name, lbs))})</span>
  );
}

function FoodOverviewPage() {
  const overviewFn = useServerFn(getFoodOverview);
  const yieldFn = useServerFn(getFoodYieldProgress);
  const q = useQuery({ queryKey: ["food", "overview"], queryFn: () => overviewFn() });
  const yq = useQuery({ queryKey: ["food", "yield-progress"], queryFn: () => yieldFn() });
  const data = q.data;
  const totals = yq.data?.totals;
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const allCats = yq.data?.categories ?? [];
  const availableCats = useMemo(
    () => new Set(allCats.map((c) => c.category)),
    [allCats],
  );
  const visibleCats = useMemo(
    () => (categoryFilter === "all" ? allCats : allCats.filter((c) => c.category === categoryFilter)),
    [allCats, categoryFilter],
  );

  const filteredTotals = useMemo(() => {
    if (categoryFilter === "all") return totals;
    return visibleCats.reduce(
      (acc, cat) => ({
        expected_pounds: acc.expected_pounds + cat.expected_pounds,
        estimated_pounds: acc.estimated_pounds + cat.estimated_pounds,
        actual_pounds: acc.actual_pounds + cat.actual_pounds,
        planned_gap_pounds: acc.planned_gap_pounds + cat.planned_gap_pounds,
        planned_gap_value: acc.planned_gap_value + cat.planned_gap_value,
        actual_gap_pounds: acc.actual_gap_pounds + cat.actual_gap_pounds,
        actual_gap_value: acc.actual_gap_value + cat.actual_gap_value,
        storage_pounds: acc.storage_pounds + cat.storage_pounds,
        mitigated_gap_pounds: acc.mitigated_gap_pounds + cat.mitigated_gap_pounds,
        mitigated_gap_value: acc.mitigated_gap_value + cat.mitigated_gap_value,
      }),
      {
        expected_pounds: 0,
        estimated_pounds: 0,
        actual_pounds: 0,
        planned_gap_pounds: 0,
        planned_gap_value: 0,
        actual_gap_pounds: 0,
        actual_gap_value: 0,
        storage_pounds: 0,
        mitigated_gap_pounds: 0,
        mitigated_gap_value: 0,
      },
    );
  }, [categoryFilter, visibleCats, totals]);

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Production hub: plantings, herds, batches, and pantry stock. Use the
        sub-tabs above to drill in.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Garden plantings" value={data?.garden_plantings ?? 0} to="/food/garden" />
        <StatCard label="Food forest" value={data?.food_forest_count ?? 0} to="/food/orchard" />
        <StatCard label="Timber" value={data?.timber_count ?? 0} to="/food/orchard" />
        <StatCard label="Livestock" value={data?.livestock_count ?? 0} to="/food/livestock" />
        <StatCard label="Recent harvests" value={data?.recent_harvests?.length ?? 0} to="/food/crops" />
      </div>

        <section>
        <div className="mb-3">
          <h2 className="text-sm font-semibold">Annual production by food category</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Each grouping below is a food category (e.g., Vegetables, Fruits). It compares how much you
            <span className="underline decoration-dotted" title="Based on weekly food plan quantities">plan to eat</span>{" "}
            versus how much you have
            <span className="underline decoration-dotted" title="Estimated from garden plantings and orchard trees">planted</span>{" "}
            and
            <span className="underline decoration-dotted" title="Logged harvests">actually harvested</span>.
            Expand a category to see individual foods and their gaps.
          </p>
        </div>

        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            Category
          </span>
          <button
            type="button"
            onClick={() => setCategoryFilter("all")}
            className={`text-xs px-2 py-1 rounded border transition-colors ${
              categoryFilter === "all"
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border hover:bg-accent"
            }`}
          >
            All ({allCats.length})
          </button>
          {FOOD_CATEGORIES.map((c) => {
            const has = availableCats.has(c);
            const active = categoryFilter === c;
            return (
              <button
                key={c}
                type="button"
                disabled={!has}
                onClick={() => setCategoryFilter(c)}
                className={`text-xs px-2 py-1 rounded border transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : has
                      ? "border-border hover:bg-accent"
                      : "border-border opacity-40 cursor-not-allowed"
                }`}
                title={has ? c : `${c} (no items)`}
              >
                {c}
              </button>
            );
          })}
        </div>

        <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
          {categoryFilter === "all" ? "All categories" : categoryFilter}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3 mb-3">
          <SummaryStat label="Plan need" value={`${fmtLbs(filteredTotals?.expected_pounds ?? 0)} lbs`} kcal={kcalTotal(filteredTotals?.expected_pounds ?? 0)} />
          <SummaryStat label="Est. yield (planted)" value={`${fmtLbs(filteredTotals?.estimated_pounds ?? 0)} lbs`} kcal={kcalTotal(filteredTotals?.estimated_pounds ?? 0)} />
          <SummaryStat label="Harvested" value={`${fmtLbs(filteredTotals?.actual_pounds ?? 0)} lbs`} kcal={kcalTotal(filteredTotals?.actual_pounds ?? 0)} />
          <SummaryStat
            label="Planned gap"
            sublabel="need − planted"
            value={`${fmtLbs(filteredTotals?.planned_gap_pounds ?? 0)} lbs`}
            kcal={kcalTotal(filteredTotals?.planned_gap_pounds ?? 0)}
            secondary={fmtUsd(filteredTotals?.planned_gap_value ?? 0)}
            accent
          />
          <SummaryStat
            label="Actual gap"
            sublabel="need − harvested"
            value={`${fmtLbs(filteredTotals?.actual_gap_pounds ?? 0)} lbs`}
            kcal={kcalTotal(filteredTotals?.actual_gap_pounds ?? 0)}
            secondary={fmtUsd(filteredTotals?.actual_gap_value ?? 0)}
            accent
          />
          <SummaryStat
            label="Storage supplement"
            sublabel="pantry on hand (reconstituted)"
            value={`${fmtLbs(filteredTotals?.storage_pounds ?? 0)} lbs`}
            kcal={kcalTotal(filteredTotals?.storage_pounds ?? 0)}
          />
          <SummaryStat
            label="Net gap"
            sublabel="actual − storage"
            value={`${fmtLbs(filteredTotals?.mitigated_gap_pounds ?? 0)} lbs`}
            kcal={kcalTotal(filteredTotals?.mitigated_gap_pounds ?? 0)}
            secondary={fmtUsd(filteredTotals?.mitigated_gap_value ?? 0)}
            accent
          />
        </div>

        {yq.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!yq.isLoading && allCats.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No plan data yet — add foods and weekly quantities under{" "}
            <Link to="/food/plan" className="underline">Food Plan</Link>.
          </p>
        )}
        {!yq.isLoading && allCats.length > 0 && visibleCats.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No items in <span className="font-mono">{categoryFilter}</span>.{" "}
            <button type="button" onClick={() => setCategoryFilter("all")} className="underline">
              Clear filter
            </button>
          </p>
        )}
        <div className="overflow-x-auto border border-border rounded-md bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs font-mono uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="p-2 text-left">Category</th>
                <th className="p-2 text-right">Foods</th>
                <th className="p-2 text-right">Annual need</th>
                <th className="p-2 text-right">Planted estimate</th>
                <th className="p-2 text-right">Harvested</th>
                <th className="p-2 text-right">Pantry</th>
                <th className="p-2 text-right">Net gap</th>
                <th className="p-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visibleCats.map((cat) => (
                <CategoryBlock key={cat.category} cat={cat} />
              ))}
            </tbody>
          </table>
        </div>
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
  const pantryCovered = cat.actual_gap_pounds > 0 && cat.mitigated_gap_pounds <= 0;
  return (
    <>
      <tr className="hover:bg-accent/50">
        <td className="p-2 align-top">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2 font-medium text-left hover:underline"
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <span>{cat.category}</span>
          </button>
          <div className="mt-1"><ProgressBar progress={cat.progress} /></div>
        </td>
        <td className="p-2 text-right font-mono align-top">{cat.items.length}</td>
        <td className="p-2 text-right font-mono align-top">{fmtLbs(cat.expected_pounds)} lbs</td>
        <td className="p-2 text-right font-mono align-top">{fmtLbs(cat.estimated_pounds)} lbs</td>
        <td className="p-2 text-right font-mono align-top">{fmtLbs(cat.actual_pounds)} lbs</td>
        <td className="p-2 text-right font-mono align-top">{fmtLbs(cat.storage_pounds)} lbs</td>
        <td className={`p-2 text-right font-mono align-top ${cat.mitigated_gap_pounds > 0 ? "text-destructive" : "text-emerald-500"}`}>
          {fmtLbs(cat.mitigated_gap_pounds)} lbs
        </td>
        <td className="p-2 align-top text-xs text-muted-foreground">
          {cat.mitigated_gap_pounds > 0
            ? `${fmtUsd(cat.mitigated_gap_value)} short after harvest + pantry`
            : pantryCovered
              ? "Pantry covers current harvest gap"
              : pct >= 100
                ? "Harvest target met"
                : `${pct}% harvested`}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={8} className="p-0 bg-muted/20">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground font-mono uppercase">
                  <tr>
                    <th className="p-2 text-left">Food</th>
                    <th className="p-2 text-right">Need</th>
                    <th className="p-2 text-right">Planted</th>
                    <th className="p-2 text-right">Harvested</th>
                    <th className="p-2 text-right">Pantry</th>
                    <th className="p-2 text-right">Net gap</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {cat.items.map((item) => (
                    <FoodItemRow key={item.food_id} item={item} />
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function FoodItemRow({ item }: { item: Category["items"][number] }) {
  const [open, setOpen] = useState(false);
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
            <span className="truncate">
              {item.name}{" "}
              <span className="text-[10px] font-mono uppercase text-muted-foreground ml-1">
                {item.source}
              </span>
            </span>
            <span className="text-xs font-mono text-muted-foreground shrink-0">
              need {fmtLbs(item.expected_pounds)} · est {fmtLbs(item.estimated_pounds)} · harv {fmtLbs(item.actual_pounds)} lbs
              <KcalSpan name={item.name} lbs={item.expected_pounds} />
              {item.planned_gap_pounds > 0 && (
                <> · <span className="text-amber-500">plan gap {fmtLbs(item.planned_gap_pounds)} lbs<KcalSpan name={item.name} lbs={item.planned_gap_pounds} />{item.price_per_lb > 0 && <> / {fmtUsd(item.planned_gap_value)}</>}</span></>
              )}
              {item.actual_gap_pounds > 0 && (
                <> · <span className="text-destructive">actual gap {fmtLbs(item.actual_gap_pounds)} lbs<KcalSpan name={item.name} lbs={item.actual_gap_pounds} />{item.price_per_lb > 0 && <> / {fmtUsd(item.actual_gap_value)}</>}</span></>
              )}
              {item.storage_pounds > 0 && (
                <> · <span className="text-sky-500">storage {fmtLbs(item.storage_pounds)} lbs<KcalSpan name={item.name} lbs={item.storage_pounds} /></span></>
              )}
              {item.actual_gap_pounds > 0 && (
                <> · <span className={item.mitigated_gap_pounds > 0 ? "text-destructive" : "text-emerald-500"}>
                  net gap {fmtLbs(item.mitigated_gap_pounds)} lbs<KcalSpan name={item.name} lbs={item.mitigated_gap_pounds} />{item.price_per_lb > 0 && <> / {fmtUsd(item.mitigated_gap_value)}</>}
                </span></>
              )}
            </span>
          </div>
          <div className="mt-1.5">
            <ProgressBar progress={item.progress} />
          </div>
        </div>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 grid grid-cols-1 md:grid-cols-3 gap-4 bg-muted/30">
          <div>
            <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
              Planted units ({item.plantings.length})
            </div>
            {item.plantings.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nothing planted matching this food yet.
              </p>
            ) : (
              <ul className="text-xs space-y-1">
                {item.plantings.map((p, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span className="capitalize truncate">
                      <span className="text-[10px] font-mono uppercase text-muted-foreground mr-1">
                        {p.source}
                      </span>
                      {p.name}
                    </span>
                    <span className="font-mono whitespace-nowrap">
                      {p.count} × {p.yield_per_unit_lbs.toFixed(1)} lbs ={" "}
                      <span className="text-foreground">{fmtLbs(p.estimated_pounds)} lbs</span>
                      <KcalSpan name={item.name} lbs={p.estimated_pounds} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
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
                      <span className="text-muted-foreground">({fmtLbs(h.pounds)} lbs<KcalSpan name={item.name} lbs={h.pounds} />)</span>
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

function SummaryStat({
  label,
  sublabel,
  value,
  kcal,
  secondary,
  accent,
}: {
  label: string;
  sublabel?: string;
  value: string;
  kcal?: string;
  secondary?: string;
  accent?: boolean;
}) {
  return (
    <div className="border border-border rounded-md p-3 bg-card">
      <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {sublabel && (
        <div className="text-[10px] font-mono text-muted-foreground/70 mt-0.5">
          {sublabel}
        </div>
      )}
      <div className={`text-xl font-mono font-semibold mt-1 ${accent ? "text-destructive" : ""}`}>
        {value}
      </div>
      {kcal && (
        <div className="text-[10px] font-mono text-muted-foreground mt-0.5">≈ {kcal}</div>
      )}
      {secondary && (
        <div className="text-xs font-mono text-muted-foreground mt-0.5">{secondary}</div>
      )}
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
