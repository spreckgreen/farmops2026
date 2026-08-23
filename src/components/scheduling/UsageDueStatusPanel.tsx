import { Badge } from "@/components/ui/badge";
import { CalendarClock, Gauge, TrendingUp } from "lucide-react";
import { urgencyLabels, type UsageDueStatus, type Urgency } from "@/lib/usage-due-status";

const urgencyStyles: Record<Urgency, string> = {
  overdue: "bg-red-500/20 text-red-300 border-red-500/30",
  critical: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  soon: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  planned: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  unknown: "bg-muted text-muted-foreground border-border",
};

const barColors: Record<Urgency, string> = {
  overdue: "bg-red-400",
  critical: "bg-orange-400",
  soon: "bg-amber-400",
  planned: "bg-emerald-400",
  unknown: "bg-muted-foreground/40",
};

const num = (n: number, digits = 0) =>
  n.toLocaleString(undefined, { maximumFractionDigits: digits });

const UsageDueStatusPanel = ({ status }: { status: UsageDueStatus }) => {
  const pct = status.progress == null ? null : Math.round(status.progress * 100);

  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Usage-based due status
        </span>
        <Badge variant="outline" className={`text-xs ${urgencyStyles[status.urgency]}`}>
          {urgencyLabels[status.urgency]}
        </Badge>
      </div>

      <p className="text-sm">{status.summary}</p>

      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-xs text-muted-foreground">
        <div>
          <div className="text-foreground">
            {status.current == null ? "—" : `${num(status.current, 1)} ${status.unit}`}
          </div>
          <div>Current reading</div>
        </div>
        <div>
          <div className="text-foreground">
            {num(status.nextThreshold)} {status.unit}
          </div>
          <div>Next threshold (every {num(status.interval)} {status.unit})</div>
        </div>
        <div>
          <div className="text-foreground flex items-center gap-1">
            <TrendingUp className="h-3 w-3" />
            {status.ratePerDay == null ? "No rate yet" : `${num(status.ratePerDay, 2)} ${status.unit}/day`}
          </div>
          <div>
            {status.ratePerDay == null
              ? status.rateSamples < 2
                ? "Needs 2+ usage readings"
                : "Readings show no change"
              : `From ${status.rateSamples} readings${
                  status.rateSpanDays ? ` over ${num(status.rateSpanDays)} days` : ""
                }`}
          </div>
        </div>
        <div>
          <div className="text-foreground flex items-center gap-1">
            <CalendarClock className="h-3 w-3" />
            {status.estimatedDueDate
              ? status.estimatedDueDate.toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })
              : "—"}
          </div>
          <div>
            {status.estimatedDueDate && status.daysUntilDue != null
              ? status.daysUntilDue < 0
                ? `Estimated ${Math.abs(status.daysUntilDue)} days ago`
                : `Estimated due in ${status.daysUntilDue} days`
              : "Estimated due date"}
          </div>
        </div>
      </div>

      {pct != null && (
        <div className="mt-2 flex items-center gap-2">
          <span className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
            <span
              className={`block h-full ${barColors[status.urgency]}`}
              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
            />
          </span>
          <span className="text-xs text-muted-foreground">{pct}% of interval</span>
        </div>
      )}
    </div>
  );
};

export default UsageDueStatusPanel;
