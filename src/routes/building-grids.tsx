// Moved into Electrical → Maps & topologies → Site grids. Kept as a permanent redirect.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/building-grids")({
  ssr: false,
  beforeLoad: () => {
    throw redirect({ to: "/electrical/site-grids" });
  },
});
