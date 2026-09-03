/** GET /api/v1/electrical — API index (see the splat route for the rest). */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/electrical/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { authorizeApiRequest, handleApiRead } = await import("@/lib/electrical-api.server");
        const caller = await authorizeApiRequest(request, "read", {
          scope: "electrical:read",
          bucket: "read",
        });
        if (caller instanceof Response) return caller;
        return handleApiRead(caller, []);
      },
    },
  },
});
