import { createServerFn } from "@tanstack/react-start";

export interface SelfHostConfig {
  /** True when SELF_HOST_MODE=true — hides Lovable-hosted-only UI. */
  selfHostMode: boolean;
  /** Whether a legacy environment-based custom provider is configured. */
  aiProvider: "custom" | "none";
  hasCustomAi: boolean;
  /** Custom base URL (safe: operator-configured, no secret). */
  customAiBaseUrl: string | null;
  /** Custom model override, if set. */
  customAiModel: string | null;
  /** Origin used for outbound webhook callback URLs. */
  publicAppUrl: string | null;
  webhookOrigin: string;
  /** Human-friendly configuration status. */
  aiFallbackNote: string;
}

export const getSelfHostConfig = createServerFn({ method: "GET" }).handler(
  async (): Promise<SelfHostConfig> => {
    const selfHostMode =
      String(process.env.SELF_HOST_MODE ?? "").toLowerCase() === "true";
    const customBase = process.env.CUSTOM_AI_BASE_URL || null;
    const customKey = Boolean(process.env.CUSTOM_AI_API_KEY);
    const hasCustomAi = Boolean(customBase) && customKey;

    const aiProvider: "custom" | "none" = hasCustomAi ? "custom" : "none";

    const publicAppUrl = process.env.PUBLIC_APP_URL || null;
    const webhookOrigin = publicAppUrl || "https://bostead.lovable.app";

    const aiFallbackNote =
      aiProvider === "none"
        ? "AI-powered features (weekly/monthly report generation, task summary drafts, and Southern Ohio price refresh) are disabled. Buttons remain visible but are non-functional until AI credentials are configured."
        : aiProvider === "custom"
          ? `AI calls are routed to your custom endpoint (${customBase}). Model defaults still apply unless CUSTOM_AI_MODEL is set.`
          : "AI calls use the configured custom endpoint.";

    return {
      selfHostMode,
      aiProvider,
      hasCustomAi,
      customAiBaseUrl: customBase,
      customAiModel: process.env.CUSTOM_AI_MODEL || null,
      publicAppUrl,
      webhookOrigin,
      aiFallbackNote,
    };
  },
);
