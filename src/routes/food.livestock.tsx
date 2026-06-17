import { createFileRoute } from "@tanstack/react-router";
import { Printer } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { openPrintWindow } from "@/lib/print";
import { YieldDashboard } from "@/components/yield-dashboard";
import { getLivestockDashboard } from "@/lib/food.functions";

export const Route = createFileRoute("/food/livestock")({
  component: LivestockComingSoon,
});

function LivestockComingSoon() {
  function printLivestock() {
    openPrintWindow(
      "Livestock",
      `<header><h1>Livestock</h1><div class="meta">printed ${new Date().toLocaleDateString()}</div></header>
       <table>
         <thead><tr><th>Tag</th><th>Species</th><th>Breed</th><th>Sex</th><th>Birth date</th><th>Weight</th><th>Notes</th></tr></thead>
         <tbody>${Array.from({ length: 20 })
           .map(() => `<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`)
           .join("")}</tbody>
       </table>
       <p style="font-size:10px;color:#666;margin-top:8px">Blank intake sheet. Livestock tracking in the app is coming soon.</p>`,
    );
  }

  // Placeholder dashboard until livestock data model is implemented.
  const emptyDash = {
    summary: {
      distinct_items: 0,
      total_units: 0,
      total_expected_yield_lbs: 0,
      total_needed_lbs: 0,
      total_expected_yield_value: 0,
      total_gap_value: 0,
    },
    items: [],
    gaps: [],
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-mono font-semibold">Livestock</h2>
          <p className="text-sm text-muted-foreground">Animals, weights, feed, births, treatments, and sales.</p>
        </div>
        <Button variant="outline" size="sm" onClick={printLivestock}>
          <Printer className="h-4 w-4 mr-2" /> Print blank sheet
        </Button>
      </div>

      <YieldDashboard
        data={emptyDash}
        labels={{
          unit: "animal",
          unitPlural: "animals",
          perUnitLabel: "lbs/animal",
          needUnitsLabel: "Need animals",
          totalUnitsCardLabel: "Total animals",
          yieldPanelTitle: "Livestock · estimated annual yield",
        }}
      />

      <div className="border border-dashed border-border rounded-md p-10 text-center">
        <p className="text-sm text-muted-foreground">
          Full tracking is coming in the next pass. The dashboard above will populate once livestock entries are added.
          In the meantime you can print a blank intake sheet to record animals on paper.
        </p>
      </div>
    </div>
  );
}
