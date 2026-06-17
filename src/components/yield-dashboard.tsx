import { fmtUsd } from "@/lib/currency";

export type YieldDashboardItem = {
  key: string;
  name: string;
  count: number;
  yield_per_unit_lbs: number;
  expected_yield_lbs: number;
  needed_lbs: number;
  units_needed: number;
  gap_units: number;
  gap_lbs: number;
  price_per_lb: number;
  expected_yield_value: number;
  gap_value: number;
};

export type YieldDashboardData = {
  summary: {
    distinct_items: number;
    total_units: number;
    total_expected_yield_lbs: number;
    total_needed_lbs: number;
    total_expected_yield_value: number;
    total_gap_value: number;
  };
  items: YieldDashboardItem[];
  gaps: YieldDashboardItem[];
};

type Labels = {
  /** singular noun, e.g. "tree", "plant", "planting" */
  unit: string;
  /** plural noun, e.g. "trees" */
  unitPlural: string;
  /** column header for per-unit yield, e.g. "lbs/tree" */
  perUnitLabel: string;
  /** column header in gap table for plants/trees needed */
  needUnitsLabel: string;
  /** label shown in summary card */
  totalUnitsCardLabel: string;
  /** main panel heading */
  yieldPanelTitle: string;
};

export function YieldDashboard({
  data,
  labels,
}: {
  data: YieldDashboardData | undefined;
  labels: Labels;
}) {
  if (!data) return null;
  const s = data.summary;
  const items = data.items.filter((i) => i.count > 0 || i.needed_lbs > 0);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <DashStat label={`Distinct ${labels.unitPlural}`} value={String(s.distinct_items)} />
        <DashStat label={labels.totalUnitsCardLabel} value={String(s.total_units)} />
        <DashStat
          label="Est. yield / season"
          value={`${s.total_expected_yield_lbs.toFixed(0)} lbs`}
        />
        <DashStat label="Yield value" value={fmtUsd(s.total_expected_yield_value)} />
        <DashStat
          label="Plan need / season"
          value={`${s.total_needed_lbs.toFixed(0)} lbs`}
        />
        <DashStat label="Gap value" value={fmtUsd(s.total_gap_value)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="border border-border rounded-md bg-card">
          <div className="px-3 py-2 border-b border-border text-xs font-mono uppercase tracking-wider text-muted-foreground">
            {labels.yieldPanelTitle}
          </div>
          {items.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No {labels.unitPlural} logged yet.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="text-left px-3 py-1.5 font-normal">Item</th>
                  <th className="text-right px-3 py-1.5 font-normal">Count</th>
                  <th className="text-right px-3 py-1.5 font-normal">{labels.perUnitLabel}</th>
                  <th className="text-right px-3 py-1.5 font-normal">Est. lbs</th>
                  <th className="text-right px-3 py-1.5 font-normal">$/lb</th>
                  <th className="text-right px-3 py-1.5 font-normal">Value</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.key} className="border-b border-border/50 last:border-0">
                    <td className="px-3 py-1.5 capitalize">{p.name}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{p.count}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                      {p.yield_per_unit_lbs.toFixed(1)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">
                      {p.expected_yield_lbs.toFixed(1)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                      {p.price_per_lb > 0 ? fmtUsd(p.price_per_lb) : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">
                      {p.price_per_lb > 0 ? fmtUsd(p.expected_yield_value) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="border border-border rounded-md bg-card">
          <div className="px-3 py-2 border-b border-border text-xs font-mono uppercase tracking-wider text-muted-foreground flex justify-between">
            <span>Gaps · need vs. {labels.unitPlural}</span>
            <span>{data.gaps.length} short</span>
          </div>
          {data.gaps.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              No gaps — every planned food is covered (or no plan entries).
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="text-left px-3 py-1.5 font-normal">Item</th>
                  <th className="text-right px-3 py-1.5 font-normal">Need lbs</th>
                  <th className="text-right px-3 py-1.5 font-normal">Have</th>
                  <th className="text-right px-3 py-1.5 font-normal">{labels.needUnitsLabel}</th>
                  <th className="text-right px-3 py-1.5 font-normal text-destructive">Gap</th>
                  <th className="text-right px-3 py-1.5 font-normal text-destructive">Gap $</th>
                </tr>
              </thead>
              <tbody>
                {data.gaps.map((p) => (
                  <tr key={p.key} className="border-b border-border/50 last:border-0">
                    <td className="px-3 py-1.5 capitalize">{p.name}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{p.needed_lbs.toFixed(1)}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                      {p.count}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">
                      {p.units_needed > 0 ? p.units_needed : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-destructive">
                      {p.gap_units > 0 ? `+${p.gap_units}` : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-destructive">
                      {p.price_per_lb > 0 ? fmtUsd(p.gap_value) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function DashStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border rounded-md p-3 bg-card">
      <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="text-xl font-mono font-semibold mt-1">{value}</div>
    </div>
  );
}
