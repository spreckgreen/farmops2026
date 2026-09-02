// Running AI "bill" of metered usage, per user.
//
// Only cloud runs carry a cost — a self-hosted run is counted but priced at $0,
// e.g. "12 runs (4 cloud) · $0.0412" means eight runs stayed on your own box.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Receipt } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getAiUsageBill } from "@/lib/ai-usage.functions";
import { formatBillUsd, type AiUsageBill } from "@/lib/ai-usage";

const WINDOWS = [7, 30, 90] as const;

export function useAiUsageBill(days: number) {
  const fn = useServerFn(getAiUsageBill);
  return useQuery<AiUsageBill>({
    queryKey: ["admin", "ai-usage-bill", days],
    queryFn: () => fn({ data: { days } }),
  });
}

export function AiUsageBillCard() {
  const [days, setDays] = useState<number>(30);
  const q = useAiUsageBill(days);
  const bill = q.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Receipt className="h-4 w-4" />
          AI usage bill
          {bill && (
            <Badge variant="secondary" className="ml-1">
              {formatBillUsd(bill.totalCostUsd)}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          {WINDOWS.map((w) => (
            <Button
              key={w}
              size="sm"
              variant={days === w ? "default" : "outline"}
              onClick={() => setDays(w)}
            >
              {w} days
            </Button>
          ))}
        </div>

        <p className="text-sm text-muted-foreground">
          Metered cost of AI that ran outside the self-hosted engine, priced from
          published per-million-token rates. Self-hosted runs are counted but cost
          nothing. Token counts are actuals where the model reported them and
          per-feature estimates otherwise.
        </p>

        {q.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {q.error && (
          <div className="text-sm text-destructive">
            Failed to load: {(q.error as Error).message}
          </div>
        )}

        {bill && bill.rows.length === 0 && (
          <div className="text-sm text-muted-foreground">
            No AI runs recorded in this window.
          </div>
        )}

        {bill && bill.rows.length > 0 && (
          <>
            <div className="text-sm">
              {bill.totalRuns} runs · {bill.totalMeteredRuns} on cloud AI ·{" "}
              <span className="font-semibold">{formatBillUsd(bill.totalCostUsd)}</span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead className="text-right">Runs</TableHead>
                  <TableHead className="text-right">Cloud</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bill.rows.map((row) => (
                  <TableRow key={row.userId}>
                    <TableCell className="align-top">
                      <div className="font-medium">{row.email ?? row.userId.slice(0, 8) + "…"}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {row.byArea
                          .slice(0, 3)
                          .map((a) => `${a.label} (${a.runs})`)
                          .join(", ")}
                      </div>
                      {row.lastRunAt && (
                        <div className="text-[11px] text-muted-foreground">
                          Last run {new Date(row.lastRunAt).toLocaleString()}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right align-top">{row.runs}</TableCell>
                    <TableCell className="text-right align-top">{row.meteredRuns}</TableCell>
                    <TableCell className="text-right align-top font-mono text-xs">
                      {(row.inputTokens + row.outputTokens).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right align-top font-semibold">
                      {formatBillUsd(row.costUsd)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
