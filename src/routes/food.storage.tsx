import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/food/storage")({
  component: StorageComingSoon,
});

function StorageComingSoon() {
  return (
    <div className="border border-dashed border-border rounded-md p-10 text-center">
      <h2 className="text-lg font-mono font-semibold mb-2">Food storage</h2>
      <p className="text-sm text-muted-foreground">
        Pantry, fridge, freezer, and cellar inventory with in/out moves and
        best-by dates.
        <br />
        Coming in the next pass of the Food Production rollout.
      </p>
    </div>
  );
}
