import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Calendar, Search } from "lucide-react";
import seasonsData from "@/data/plant-seasons.json";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/food/seasons")({
  component: SeasonsPage,
});

type Row = {
  name: string;
  kind: string;
  season: string;
  lead: string;
  notes: string;
};

const SEASON_BUCKETS = [
  "All Year",
  "Spring",
  "Summer",
  "Fall",
  "Winter",
] as const;

function matchBucket(season: string, bucket: string): boolean {
  const s = season.toLowerCase();
  if (bucket === "All Year") return s.includes("all year");
  return s.includes(bucket.toLowerCase());
}

const SEASON_COLORS: Record<string, string> = {
  "All Year": "bg-muted text-muted-foreground border-border",
  Spring: "bg-emerald-500/20 text-emerald-200 border-emerald-500/40",
  Summer: "bg-amber-500/20 text-amber-200 border-amber-500/40",
  Fall: "bg-orange-500/20 text-orange-200 border-orange-500/40",
  Winter: "bg-sky-500/20 text-sky-200 border-sky-500/40",
};

function seasonBadges(season: string) {
  const tags = SEASON_BUCKETS.filter((b) => matchBucket(season, b));
  if (!tags.length) return [season];
  return tags;
}

function SeasonsPage() {
  const rows = seasonsData as Row[];
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<string>("all");
  const [bucket, setBucket] = useState<string>("all");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (kind !== "all" && r.kind.toLowerCase() !== kind) return false;
      if (bucket !== "all" && !matchBucket(r.season, bucket)) return false;
      if (
        needle &&
        !r.name.toLowerCase().includes(needle) &&
        !r.season.toLowerCase().includes(needle) &&
        !r.notes.toLowerCase().includes(needle)
      )
        return false;
      return true;
    });
  }, [rows, q, kind, bucket]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-mono font-semibold flex items-center gap-2">
            <Calendar className="h-4 w-4" /> Plant seasons reference
          </h2>
          <p className="text-sm text-muted-foreground">
            Seasonal availability for {rows.length} fruits and vegetables.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, season, notes…"
            className="pl-8"
          />
        </div>
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All kinds</SelectItem>
            <SelectItem value="fruit">Fruit</SelectItem>
            <SelectItem value="vegitable">Vegetable</SelectItem>
          </SelectContent>
        </Select>
        <Select value={bucket} onValueChange={setBucket}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All seasons</SelectItem>
            {SEASON_BUCKETS.map((b) => (
              <SelectItem key={b} value={b}>{b}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2">Name</th>
              <th className="text-left px-3 py-2">Kind</th>
              <th className="text-left px-3 py-2">Season</th>
              <th className="text-left px-3 py-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={`${r.name}-${i}`} className="border-t border-border">
                <td className="px-3 py-2 font-mono">{r.name}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.kind}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {seasonBadges(r.season).map((t) => (
                      <Badge
                        key={t}
                        variant="outline"
                        className={SEASON_COLORS[t] ?? ""}
                      >
                        {t === r.season ? t : t}
                      </Badge>
                    ))}
                    {r.season && !SEASON_BUCKETS.some((b) => matchBucket(r.season, b)) && (
                      <span className="text-xs text-muted-foreground">{r.season}</span>
                    )}
                    {SEASON_BUCKETS.some((b) => matchBucket(r.season, b)) &&
                      r.season &&
                      !SEASON_BUCKETS.includes(r.season as (typeof SEASON_BUCKETS)[number]) && (
                        <span className="text-xs text-muted-foreground ml-1">({r.season})</span>
                      )}
                  </div>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{r.notes}</td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                  No matches.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
