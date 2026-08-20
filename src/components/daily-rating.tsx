import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Battery, Gauge } from "lucide-react";
import { toast } from "sonner";
import { setDailyNoteRatings } from "@/lib/log.functions";

/**
 * Daily colour indicator: two 1-5 scales (Energy, Productivity) stored on the
 * day's note. Colours come from the --rating-1..5 design tokens so the scale
 * reads red (low) → green (high) in any theme.
 */

export const RATING_LABELS = ["", "Drained", "Low", "Okay", "Good", "Peak"] as const;

const SWATCH = [
  "",
  "bg-rating-1",
  "bg-rating-2",
  "bg-rating-3",
  "bg-rating-4",
  "bg-rating-5",
] as const;

export function ratingSwatchClass(level: number | null | undefined): string {
  if (!level || level < 1 || level > 5) return "bg-muted";
  return SWATCH[level];
}

/** Small read-only two-tone dot used in lists (energy top, productivity bottom). */
export function DailyRatingDot({
  energy,
  productivity,
  className = "",
}: {
  energy: number | null;
  productivity: number | null;
  className?: string;
}) {
  if (!energy && !productivity) return null;
  return (
    <span
      className={`inline-flex h-3.5 w-3.5 flex-col overflow-hidden rounded-full border border-border ${className}`}
      title={`Energy ${energy ?? "–"}/5 · Productivity ${productivity ?? "–"}/5`}
      aria-label={`Energy ${energy ?? "not set"} of 5, productivity ${productivity ?? "not set"} of 5`}
    >
      <span className={`h-1/2 w-full ${ratingSwatchClass(energy)}`} />
      <span className={`h-1/2 w-full ${ratingSwatchClass(productivity)}`} />
    </span>
  );
}

function Scale({
  label,
  icon,
  value,
  onChange,
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  value: number | null;
  onChange: (v: number | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex w-[104px] shrink-0 items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </span>
      <div className="flex items-center gap-1" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => {
          const active = value === n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              title={`${label}: ${n}/5 — ${RATING_LABELS[n]}${active ? " (click to clear)" : ""}`}
              onClick={() => onChange(active ? null : n)}
              className={`h-5 w-5 rounded-sm border transition-transform ${ratingSwatchClass(n)} ${
                active
                  ? "border-foreground scale-110"
                  : "border-border/60 opacity-40 hover:opacity-80"
              } disabled:cursor-not-allowed`}
            >
              <span className="sr-only">{`${label} ${n}`}</span>
            </button>
          );
        })}
      </div>
      <span className="text-[11px] font-mono text-muted-foreground">
        {value ? `${value}/5 · ${RATING_LABELS[value]}` : "not set"}
      </span>
    </div>
  );
}

export function DailyRatingPanel({
  noteId,
  date,
  energy,
  productivity,
}: {
  noteId: string | undefined;
  date: string;
  energy: number | null;
  productivity: number | null;
}) {
  const saveFn = useServerFn(setDailyNoteRatings);
  const qc = useQueryClient();
  const [local, setLocal] = useState<{ energy: number | null; productivity: number | null }>({
    energy,
    productivity,
  });

  useEffect(() => {
    setLocal({ energy, productivity });
  }, [energy, productivity, noteId]);

  const save = useMutation({
    mutationFn: (patch: { energy_level?: number | null; productivity_level?: number | null }) => {
      if (!noteId) throw new Error("Note not loaded yet");
      return saveFn({ data: { noteId, ...patch } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["daily-note", date] }),
    onError: (e) => {
      setLocal({ energy, productivity });
      toast.error(e instanceof Error ? e.message : "Could not save rating");
    },
  });

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
          Day colour
        </h3>
        <DailyRatingDot energy={local.energy} productivity={local.productivity} />
      </div>
      <Scale
        label="Energy"
        icon={<Battery className="h-3 w-3" />}
        value={local.energy}
        disabled={!noteId || save.isPending}
        onChange={(v) => {
          setLocal((s) => ({ ...s, energy: v }));
          save.mutate({ energy_level: v });
        }}
      />
      <Scale
        label="Productivity"
        icon={<Gauge className="h-3 w-3" />}
        value={local.productivity}
        disabled={!noteId || save.isPending}
        onChange={(v) => {
          setLocal((s) => ({ ...s, productivity: v }));
          save.mutate({ productivity_level: v });
        }}
      />
      <p className="text-[10px] text-muted-foreground">
        Rate how the day felt alongside your tasks. Click the active swatch again to clear it.
      </p>
    </div>
  );
}
