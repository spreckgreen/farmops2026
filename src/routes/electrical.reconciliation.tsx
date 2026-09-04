// Merged into the Import contract page — kept as a redirect so existing links,
// bookmarks and printed references keep working.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/electrical/reconciliation")({
  beforeLoad: () => {
    throw redirect({ to: "/electrical/import-contract" });
  },
});
