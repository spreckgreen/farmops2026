/**
 * Per-task date picker: move a task to any farm calendar day.
 *
 * Example: on Today (2026-08-22) pick Aug 19 → the task's `- #task/<slug>` note
 * lines, activity-log rows and start/closed stamps all move to 2026-08-19,
 * keeping their wall-clock time in the farm timezone.
 */
import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { moveTaskToDay } from "@/lib/log.functions";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { APP_TIME_ZONE } from "@/lib/app-timezone";

/** `Date` from the calendar is local-midnight; read its own Y/M/D, no UTC shift. */
function calendarDayString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function TaskMoveDay({
  taskId,
  fromDate,
  className,
}: {
  taskId: string;
  /** Day the task is currently shown on, e.g. "2026-08-22". */
  fromDate: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const moveFn = useServerFn(moveTaskToDay);
  const qc = useQueryClient();

  const move = useMutation({
    mutationFn: (toDate: string) => moveFn({ data: { taskId, date: fromDate, toDate } }),
    onSuccess: (res) => {
      setOpen(false);
      toast.success(`Moved to ${res.toDate}`, {
        description: `${res.movedLines} note line(s), ${res.movedEntries} log entr(ies) restamped`,
      });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["daily-note"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Failed to move task"),
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className={cn("shrink-0", className)}
          title={`Move this task to another day (${APP_TIME_ZONE} calendar)`}
          disabled={move.isPending}
        >
          <CalendarDays className="h-3.5 w-3.5 mr-1" />
          {move.isPending ? "Moving…" : "Move to…"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <div className="px-3 pt-3 text-[11px] font-mono text-muted-foreground">
          from {fromDate} · {APP_TIME_ZONE}
        </div>
        <Calendar
          mode="single"
          defaultMonth={new Date(`${fromDate}T12:00:00`)}
          onSelect={(d) => {
            if (!d) return;
            const target = calendarDayString(d);
            if (target === fromDate) {
              toast.info("Already on that day");
              setOpen(false);
              return;
            }
            move.mutate(target);
          }}
          className={cn("p-3 pointer-events-auto")}
        />
      </PopoverContent>
    </Popover>
  );
}
