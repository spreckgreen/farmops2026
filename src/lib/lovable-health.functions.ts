// Admin-only server function behind the Lovable Hosted health check.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const checkLovableHostedHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdminRole } = await import("./admin-role.server");
    await requireAdminRole(context.supabase, context.userId);
    const { checkLovableHosted } = await import("./lovable-health.server");
    return checkLovableHosted();
  });
