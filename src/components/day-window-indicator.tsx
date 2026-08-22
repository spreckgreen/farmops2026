/**
 * Shows the farm's active timezone and the exact UTC window a calendar day maps
 * to, so late-night placement can be verified at a glance.
 *
 * Example (America/New_York, Aug 22 2026):
 *   "America/New_York · EDT (UTC-4) · now 00:43 (2026-08-22)"
 *   "Day window 2026-08-22 → 2026-08-22T04:00:00Z – 2026-08-23T03:59:59Z"
 */
import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { APP_TIME_ZONE, appDateString, dayBoundsUtc } from "@/lib/app-timezone";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function zoneAbbrev(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short",
  }).formatToParts(at);
  return parts.find((p) => p.type === "timeZoneName")?.value ?? timeZone;
}

function zoneOffsetLabel(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(at);
  return (parts.find((p) => p.type === "timeZoneName")?.value ?? "UTC")
    .replace("GMT", "UTC")
    .replace(/:00$/, "");
}

function localClock(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}

function shortUtc(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}Z`;
}

export function DayWindowIndicator({
  date,
  className,
}: {
  /** Calendar day being viewed. Defaults to the farm's current day. */
  date?: string;
  className?: string;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const farmToday = appDateString(now);
  const target = date ?? farmToday;
  const bounds = dayBoundsUtc(target);
  const isToday = target === farmToday;
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zoneMismatch = browserZone !== APP_TIME_ZONE;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={`inline-flex flex-wrap items-center gap-1.5 text-[11px] font-mono text-muted-foreground ${className ?? ""}`}
          >
            <Clock className="h-3 w-3" />
            <span>
              {APP_TIME_ZONE} · {zoneAbbrev(now, APP_TIME_ZONE)} (
              {zoneOffsetLabel(now, APP_TIME_ZONE)}) · now{" "}
              {localClock(now, APP_TIME_ZONE)} ({farmToday})
            </span>
            <Badge variant="outline" className="font-mono text-[10px]">
              {isToday ? "today" : target}
            </Badge>
            <span className="opacity-80">
              {shortUtc(bounds.start)} – {shortUtc(bounds.end)}
            </span>
            {zoneMismatch && (
              <Badge variant="secondary" className="font-mono text-[10px]">
                browser {browserZone}
              </Badge>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs font-mono text-[11px] leading-relaxed">
          <div>Farm calendar: {APP_TIME_ZONE}</div>
          <div>Viewing day: {target}</div>
          <div>Window start (UTC): {bounds.start}</div>
          <div>Window end (UTC): {bounds.end}</div>
          <div>Browser zone: {browserZone}</div>
          <div className="mt-1 opacity-80">
            A task committed at 23:00 local lands on {target}, even though UTC has
            already rolled to the next date.
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
