import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/food/livestock")({
  component: LivestockComingSoon,
});

function LivestockComingSoon() {
  return (
    <div className="border border-dashed border-border rounded-md p-10 text-center">
      <h2 className="text-lg font-mono font-semibold mb-2">Livestock</h2>
      <p className="text-sm text-muted-foreground">
        Animals, weights, feed, births, treatments, and sales.
        <br />
        Coming in the next pass of the Food Production rollout.
      </p>
    </div>
  );
}
