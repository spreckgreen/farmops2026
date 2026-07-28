import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireAuthenticatedUser } from "@/lib/auth-route";

export const Route = createFileRoute("/maintenance")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  component: MaintenanceLayout,
});

function MaintenanceLayout() {
  return <Outlet />;
}