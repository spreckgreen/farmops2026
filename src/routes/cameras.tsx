import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { ModuleGate } from "@/components/module-gate";

export const Route = createFileRoute("/cameras")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  component: CamerasLayout,
});

function CamerasLayout() {
  return (
    <ModuleGate moduleKey="cameras" title="Cameras">
      <Outlet />
    </ModuleGate>
  );
}
