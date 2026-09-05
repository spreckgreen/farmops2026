import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { ModuleGate } from "@/components/module-gate";

export const Route = createFileRoute("/security")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  component: SecurityLayout,
});

function SecurityLayout() {
  return (
    <ModuleGate moduleKey="cameras" title="Security">
      <Outlet />
    </ModuleGate>
  );
}
