import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { ModuleGate } from "@/components/module-gate";

export const Route = createFileRoute("/maintenance")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  component: MaintenanceLayout,
});

function MaintenanceLayout() {
  return (
    <ModuleGate moduleKey="maintenance" title="Maintenance">
      <Outlet />
    </ModuleGate>
  );
}
