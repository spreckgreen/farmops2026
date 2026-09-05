import { createFileRoute, redirect } from "@tanstack/react-router";

// Cameras now live as a window inside the Security tab.
export const Route = createFileRoute("/cameras/")({
  ssr: false,
  beforeLoad: () => {
    throw redirect({ to: "/security" });
  },
});
