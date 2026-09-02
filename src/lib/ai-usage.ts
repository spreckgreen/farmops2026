// Shared (client-safe) types for AI feature switches and the metered AI bill.
//
// "Metered" means the run left the self-hosted AI box: it ran on a cloud engine
// and therefore costs real money. A local run is recorded with cost 0 so you can
// still see the volume, but it never lands on the bill.
import type { AiAreaId } from "@/lib/ai-feature-areas";

export interface AiFeatureToggle {
  area: AiAreaId;
  enabled: boolean;
  note: string | null;
  updated_at: string | null;
}

export interface AiUsageEvent {
  id: string;
  user_id: string;
  area: string;
  area_label: string | null;
  engine_id: string | null;
  backend: string;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  metered: boolean;
  estimated: boolean;
  latency_ms: number | null;
  note: string | null;
  created_at: string;
}

/** One line of the running AI bill. */
export interface AiUsageBillRow {
  userId: string;
  email: string | null;
  runs: number;
  meteredRuns: number;
  localRuns: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  lastRunAt: string | null;
  /** Cost per feature area, biggest first. */
  byArea: Array<{ area: string; label: string; runs: number; costUsd: number }>;
}

export interface AiUsageBill {
  /** Inclusive window start (ISO). */
  since: string;
  days: number;
  totalRuns: number;
  totalMeteredRuns: number;
  totalCostUsd: number;
  rows: AiUsageBillRow[];
}

export function formatBillUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}
