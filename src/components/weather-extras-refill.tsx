import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CloudSun, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { refillWeatherExtras } from "@/lib/weather.functions";

const ONCE_KEY = "bostead.weatherExtrasRefill.v1";

type Result = Awaited<ReturnType<typeof refillWeatherExtras>>;

export function WeatherExtrasRefill() {
  const refill = useServerFn(refillWeatherExtras);
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const autoRan = useRef(false);

  async function run(opts: { silent?: boolean } = {}) {
    setRunning(true);
    try {
      const res = await refill({ data: {} });
      setResult(res);
      qc.invalidateQueries({ queryKey: ["weather"] });
      if (!opts.silent || res.updated > 0) {
        toast.success(
          res.candidates === 0
            ? "All cached forecasts already have humidity and feels-like."
            : `Refilled ${res.updated} of ${res.candidates} forecast${res.candidates === 1 ? "" : "s"}.`,
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Weather refill failed");
    } finally {
      setRunning(false);
    }
  }

  // One-time automatic cache bust per browser; the button below re-runs it.
  useEffect(() => {
    if (autoRan.current) return;
    autoRan.current = true;
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(ONCE_KEY)) return;
    window.localStorage.setItem(ONCE_KEY, new Date().toISOString());
    void run({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <CloudSun className="h-4 w-4 text-muted-foreground" />
            Weather cache backfill
          </h2>
          <p className="text-xs text-muted-foreground">
            Older cached forecasts were saved before humidity and feels-like existed. This refills
            those rows from the historical weather archive. It runs once automatically and only
            touches rows still missing all three values, so re-running is safe.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => run()} disabled={running}>
          <RefreshCw className={`mr-2 h-4 w-4 ${running ? "animate-spin" : ""}`} />
          {running ? "Refilling…" : "Re-run backfill"}
        </Button>
      </div>

      {result && (
        <p className="mt-3 text-xs text-muted-foreground">
          {result.candidates === 0
            ? "Nothing to fix — every cached forecast has humidity and feels-like."
            : `${result.updated} updated, ${result.unavailable} still unavailable (of ${result.candidates} rows${
                result.range ? `, ${result.range.start} → ${result.range.end}` : ""
              }).`}
        </p>
      )}
    </section>
  );
}
