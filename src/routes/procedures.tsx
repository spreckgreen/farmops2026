import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppLayout } from "@/components/app-layout";

export const Route = createFileRoute("/procedures")({
  component: () => <Outlet />,
  errorComponent: ({ error }) => (
    <AppLayout>
      <div className="max-w-3xl mx-auto p-6 text-sm text-destructive">
        Failed to load procedures: {error.message}
      </div>
    </AppLayout>
  ),
  notFoundComponent: () => (
    <AppLayout>
      <div className="max-w-3xl mx-auto p-6 text-sm text-muted-foreground">Not found.</div>
    </AppLayout>
  ),
});
