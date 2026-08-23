// One-click action: send every AI feature area marked "Hosted" back to the
// Lovable AI Gateway, clearing the runtime custom-AI overrides that would keep
// those calls on a self-hosted / alternative endpoint.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Cloud, Settings2 } from "lucide-react";
import { switchHostedToLovableAi } from "@/lib/ai-engines.functions";

export function SwitchToLovableAi({ disabled }: { disabled?: boolean }) {
  const run = useServerFn(switchHostedToLovableAi);
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => run({}),
    onSuccess: (result) => {
      const extras = [
        result.clearedKeys.length ? `cleared ${result.clearedKeys.join(", ")}` : null,
        result.switchedAreas.length
          ? `${result.switchedAreas.length} hosted area(s) updated`
          : null,
      ].filter(Boolean);
      toast.success(
        `Hosted AI features now use Lovable AI${extras.length ? ` — ${extras.join("; ")}` : ""}`,
      );
      if (result.envStillSet) {
        toast.warning(
          "CUSTOM_AI_BASE_URL / CUSTOM_AI_API_KEY are still set as deploy env vars — remove them from .env to fully stop custom routing.",
        );
      }
      void qc.invalidateQueries({ queryKey: ["ai-routing"] });
      void qc.invalidateQueries({ queryKey: ["ai-engines"] });
      void qc.invalidateQueries({ queryKey: ["self-host-config"] });
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Could not switch to Lovable AI"),
  });

  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <Button
        size="sm"
        variant="outline"
        onClick={() => mutation.mutate()}
        disabled={disabled || mutation.isPending}
      >
        <Cloud className="h-4 w-4 mr-1" />
        {mutation.isPending ? "Switching…" : "Switch to Lovable AI"}
      </Button>
      <Button asChild size="sm" variant="ghost">
        <Link to="/admin/ai-engines">
          <Settings2 className="h-4 w-4 mr-1" /> Configure engines
        </Link>
      </Button>
      <span className="text-xs text-muted-foreground">
        Resets hosted areas to Lovable AI and clears custom AI overrides.
      </span>
    </div>
  );
}
