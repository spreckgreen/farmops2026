import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ServiceSchedule } from "@/types/scheduling";
import type { Asset } from "@/components/dashboard/types";
import { format } from "date-fns";
import { Bell, Calendar, CheckCircle, Edit, Gauge, Trash2, Wrench } from "lucide-react";
import { computeReminder, type ReminderStatus } from "@/lib/maintenance-reminders";
import { computeUsageDueStatus, type UsageSnapshot, type RateSource } from "@/lib/usage-due-status";
import UsageDueStatusPanel from "@/components/scheduling/UsageDueStatusPanel";

interface ScheduleListProps {
  schedules: ServiceSchedule[];
  assets: Asset[];
  /** Usage readings keyed by inventory item id, used to estimate due dates. */
  usageSnapshots?: Record<string, UsageSnapshot[]>;
  onEdit: (schedule: ServiceSchedule) => void;
  onDelete: (id: string) => void;
  onComplete: (id: string) => void;
}

const statusColors: Record<string, string> = {
  scheduled: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  in_progress: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  completed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  overdue: "bg-red-500/20 text-red-400 border-red-500/30",
  cancelled: "bg-muted text-muted-foreground border-border",
};

const reminderColors: Record<ReminderStatus, string> = {
  ok: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  soon: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  due: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  overdue: "bg-red-500/20 text-red-300 border-red-500/30",
  unknown: "bg-muted text-muted-foreground border-border",
};

const typeIcons: Record<string, string> = {
  maintenance: "🔧",
  inspection: "🔍",
  repair: "🛠️",
  calibration: "⚙️",
  cleaning: "🧹",
  replacement: "🔄",
};

const ScheduleList = ({ schedules, assets, usageSnapshots = {}, onEdit, onDelete, onComplete }: ScheduleListProps) => {
  const getAssetName = (assetId: string) => assets.find((a) => a.id === assetId)?.name || "Unknown";

  if (schedules.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-16">
        <Wrench className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p>No service schedules yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {schedules.map((s) => {
        const asset = assets.find((a) => a.id === s.asset_id);
        const reminder = computeReminder(s, asset);
        const dueStatus =
          s.status === "completed"
            ? null
            : computeUsageDueStatus(s, asset, usageSnapshots[s.asset_id] ?? []);
        const usageOverdue = reminder.kind !== "date" && reminder.status === "overdue";
        const isDateOverdue =
          s.status === "scheduled" &&
          !!s.scheduled_date &&
          new Date(s.scheduled_date) < new Date();
        const displayStatus = s.status === "completed"
          ? "completed"
          : (usageOverdue || isDateOverdue) ? "overdue" : s.status;

        return (
          <Card key={s.id} className="p-4 bg-card border-border hover:border-primary/20 transition-colors">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-lg">{typeIcons[s.service_type] || "🔧"}</span>
                  <h3 className="font-heading font-semibold truncate">{s.title}</h3>
                  <Badge variant="outline" className={statusColors[displayStatus] || statusColors.scheduled}>
                    {displayStatus}
                  </Badge>
                  {s.recurrence && s.recurrence !== "none" && (
                    <Badge variant="outline" className="border-border text-muted-foreground text-xs">
                      ↻ {s.recurrence.startsWith("custom:") ? (() => {
                        const parts = s.recurrence!.replace("custom:", "").split(":");
                        return `Every ${parts[0]} ${parts[1]}`;
                      })() : s.recurrence}
                    </Badge>
                  )}
                  {s.status !== "completed" && (
                    <Badge variant="outline" className={`text-xs ${reminderColors[reminder.status]}`}>
                      {reminder.kind === "date" ? (
                        <Bell className="h-3 w-3 mr-1" />
                      ) : (
                        <Gauge className="h-3 w-3 mr-1" />
                      )}
                      {reminder.label}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    {s.scheduled_date
                      ? `${format(new Date(s.scheduled_date), "MMM d, yyyy h:mm a")}${
                          (s as unknown as { raw?: { scheduled_date_inferred?: boolean } }).raw
                            ?.scheduled_date_inferred
                            ? " (projected)"
                            : ""
                        }`
                      : s.recurrence
                        ? `Usage-based — ${s.recurrence}`
                        : "No date set"}
                  </span>
                  <span>Asset: <span className="text-foreground">{getAssetName(s.asset_id)}</span></span>
                </div>
                {s.consumables_used && s.consumables_used.length > 0 && (
                  <div className="flex gap-1 mt-2 flex-wrap">
                    {s.consumables_used.map((cu, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">
                        {cu.name}: {cu.quantity_used} {cu.unit}
                      </Badge>
                    ))}
                  </div>
                )}
                {s.description && <p className="text-sm text-muted-foreground mt-1 truncate">{s.description}</p>}
                {dueStatus && <UsageDueStatusPanel status={dueStatus} />}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {s.status !== "completed" && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-400 hover:text-emerald-300" onClick={() => onComplete(s.id)}>
                    <CheckCircle className="h-4 w-4" />
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(s)}>
                  <Edit className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => onDelete(s.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
};

export default ScheduleList;
