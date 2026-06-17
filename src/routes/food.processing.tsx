import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/food/processing")({
  component: ProcessingComingSoon,
});

function ProcessingComingSoon() {
  return (
    <div className="border border-dashed border-border rounded-md p-10 text-center">
      <h2 className="text-lg font-mono font-semibold mb-2">Processing batches</h2>
      <p className="text-sm text-muted-foreground">
        Canning, butchering, dairy, baking runs with inputs and yields.
        <br />
        Coming in the next pass of the Food Production rollout.
      </p>
    </div>
  );
}
