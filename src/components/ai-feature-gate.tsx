import { Link } from "@tanstack/react-router";
import { PowerOff, Settings } from "lucide-react";
import { useAiFeatureEnabled } from "@/hooks/use-ai-settings";
import { getAiFeature, WEIGHT_META } from "@/lib/ai-features";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface Props {
  featureId: string;
  children: React.ReactNode;
}

/**
 * Wraps an AI-powered surface. If the feature is disabled in AI settings,
 * shows a friendly panel with a link to /admin/ai-settings instead of
 * rendering (and firing model calls for) the real UI.
 */
export function AiFeatureGate({ featureId, children }: Props) {
  const enabled = useAiFeatureEnabled(featureId);
  if (enabled) return <>{children}</>;

  const def = getAiFeature(featureId);
  const weight = def ? WEIGHT_META[def.weight] : null;

  return (
    <div className="max-w-2xl mx-auto p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <PowerOff className="h-4 w-4" />
            {def?.label ?? "AI feature"} is disabled
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            This feature is currently turned off in your AI configuration.
            {def && (
              <>
                {" "}
                It is rated as{" "}
                {weight && (
                  <span
                    className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${weight.className}`}
                  >
                    {weight.label} usage
                  </span>
                )}{" "}
                — {def.description}
              </>
            )}
          </p>
          <p>
            If you don't have a local AI agent to offload work to, keeping
            heavier features off can save time, tokens, and credits.
          </p>
          <Button asChild size="sm">
            <Link to="/admin/ai-settings">
              <Settings className="h-4 w-4 mr-1" /> Open AI configuration
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
