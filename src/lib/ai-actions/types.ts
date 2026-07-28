// Shared types for the AI Action Framework: planner produces an ActionPlan,
// executor registry (server-only) turns each action into DB writes.
// Framework is generic — first consumer is maintenance schedule generation.

export type ActionStatus = "pending" | "applied" | "failed" | "partial";

/** Discriminated union of all executable actions. Add cases as consumers land. */
export type Action =
  | {
      type: "maintenance.create_interval";
      asset_id: string | null;
      asset_name: string;
      title: string;
      service_type: string;
      description: string;
      trigger_type: "hours" | "miles" | "months";
      interval_value: number;
      first_due_date: string | null; // ISO date; when trigger is months
      recurrence: string; // "every 100 hours" / "every 6 months" / etc.
      parts: {
        name: string;
        quantity: number;
        inventory_item_id: string | null;
      }[];
      notes: string | null;
    };

/** Result of applying one action. */
export type ActionResult =
  | { ok: true; type: Action["type"]; id: string; label: string }
  | { ok: false; type: Action["type"]; error: string; label: string };

export interface ActionPlan {
  plan_id: string; // client-generated uuid; enables idempotent Apply
  surface: string; // "maintenance.generate_schedule"
  summary: string; // one-line human-readable
  actions: Action[];
  citations: string[];
  model: string;
}
