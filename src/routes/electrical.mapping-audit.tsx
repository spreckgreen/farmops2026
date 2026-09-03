// Retired standalone page: consolidated into /electrical/grid-data-quality.
// Kept as a permanent redirect so existing links and bookmarks still work.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/electrical/mapping-audit")({
  beforeLoad: () => {
    throw redirect({
      to: "/electrical/grid-data-quality",
      search: { tab: "status" },
      replace: true,
    });
  },
});
