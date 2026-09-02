// Which AI scenarios the Electrical pane offers, and who may run them.
//
// Pure module so the navigation, the page and the server gate agree, and so the
// scoping rules are unit-testable. The server function re-checks every rule —
// hiding a scenario is not a security boundary.
//
// Scoping in one sentence: an administrator sees every scenario; an electrician
// sees only the scenarios their own add-on/role already entitles them to read.
//
// Model selection and steering are NOT decided here. Every scenario names an AI
// feature area (see ai-feature-areas.ts) so engine/model choice stays in
// Admin → AI runtime → Feature AI routing, exactly like the other AI features.
import type { AiAreaId } from "./ai-feature-areas";
import type { ElectricalAccess, ElectricalSection } from "./electrical-access";

export type ElectricalAiScenarioId =
  | "panel_qa"
  | "topology_explain"
  | "qa_triage"
  | "audit_summary"
  | "field_note";

/**
 * What a scenario needs:
 *  - `read`        — any electrical read access (full, field-write, read-only)
 *  - `field_write` — the electrician may record field changes
 *  - `reconcile`   — the full add-on (reconciliation / system-of-record work)
 *  - `admin`       — administrator only (farm-wide review of other actors)
 */
export type ElectricalAiRequirement = "read" | "field_write" | "reconcile" | "admin";

export interface ElectricalAiScenarioDef {
  id: ElectricalAiScenarioId;
  label: string;
  description: string;
  /** Routing/model selection lives with this AI feature area. */
  area: AiAreaId;
  /** Section the scenario belongs to, for nav-level access agreement. */
  section: ElectricalSection;
  requires: ElectricalAiRequirement;
  /** Does the scenario take a free-text question / note from the user? */
  input: "question" | "note" | "none";
  inputLabel: string;
  placeholder: string;
}

export const ELECTRICAL_AI_SCENARIOS: readonly ElectricalAiScenarioDef[] = [
  {
    id: "panel_qa",
    label: "Panel & circuit Q&A",
    description:
      "Ask about the as-installed record: what feeds a panel, which breaker serves a load, what is on a circuit. Read-only — nothing is written.",
    area: "electrical.panel_qa",
    section: "panel",
    requires: "read",
    input: "question",
    inputLabel: "Question",
    placeholder: "What feeds PNL-H1, and which breaker serves the mini split?",
  },
  {
    id: "topology_explain",
    label: "Topology explanation",
    description:
      "Plain-language walk of the power path from the service through feeders and panels to a load.",
    area: "electrical.topology_explain",
    section: "topology",
    requires: "read",
    input: "question",
    inputLabel: "Load, panel or area to explain",
    placeholder: "Explain how power reaches the boiler room loads.",
  },
  {
    id: "field_note",
    label: "Field note → draft change summary",
    description:
      "Turn a rough field observation into a tidy draft note you can paste into a change. It never writes an electrical record.",
    area: "electrical.field_note",
    section: "changes",
    requires: "field_write",
    input: "note",
    inputLabel: "Field observation",
    placeholder:
      "h1 slot 14 is a 20a single pole, feeds the well pump receptacle, label was wrong",
  },
  {
    id: "qa_triage",
    label: "QA / validation finding triage",
    description:
      "Group the current QA and reconciliation findings into systematic patterns. Suggestions only — adjudication stays rule-based and SHA-bound.",
    area: "electrical.qa_triage",
    section: "qa",
    requires: "reconcile",
    input: "none",
    inputLabel: "",
    placeholder: "",
  },
  {
    id: "audit_summary",
    label: "Electrician change-audit review",
    description:
      "Summarise recent audited field writes across all electricians and flag the safety-relevant fields for review.",
    area: "electrical.audit_summary",
    section: "changes",
    requires: "admin",
    input: "none",
    inputLabel: "",
    placeholder: "",
  },
] as const;

export function getElectricalAiScenario(
  id: ElectricalAiScenarioId,
): ElectricalAiScenarioDef {
  const found = ELECTRICAL_AI_SCENARIOS.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown electrical AI scenario: ${id}`);
  return found;
}

export function isElectricalAiScenarioId(
  value: unknown,
): value is ElectricalAiScenarioId {
  return (
    typeof value === "string" &&
    ELECTRICAL_AI_SCENARIOS.some((s) => s.id === value)
  );
}

export interface ElectricalAiScope {
  access: ElectricalAccess;
  isAdmin: boolean;
}

/** Can this caller run one scenario? */
export function canRunElectricalAiScenario(
  scope: ElectricalAiScope,
  def: ElectricalAiScenarioDef,
): boolean {
  // Administrators get every scenario.
  if (scope.isAdmin) return true;
  // A scanned-label viewer never gets the assistant: their window is one panel.
  if (!scope.access.canView || scope.access.scanOnly) return false;
  switch (def.requires) {
    case "read":
      return true;
    case "field_write":
      return scope.access.canWrite;
    case "reconcile":
      return scope.access.canReconcile;
    case "admin":
      return false;
  }
}

/** Scenarios this caller may see, in declaration order. */
export function electricalAiScenariosFor(
  scope: ElectricalAiScope,
): ElectricalAiScenarioDef[] {
  return ELECTRICAL_AI_SCENARIOS.filter((def) =>
    canRunElectricalAiScenario(scope, def),
  );
}

export const ELECTRICAL_AI_DENIED =
  "Your electrical access does not cover this AI scenario. An administrator can widen it in Admin → Users.";
