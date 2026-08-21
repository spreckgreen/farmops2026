// Per-workflow AI test definitions.
//
// A single generic "say AI test OK" probe proves the endpoint answers and
// nothing else: a 3B model with a 4k window passes it happily and then fails
// the two jobs that actually matter —
//   - weekly_report: a week of tasks in, a structured rollup out
//   - manual:        a procedure/manual written out long-form
//
// Each workflow below ships a realistic-sized prompt plus mechanical checks on
// the reply, so the suitability verdict is measured per workflow instead of
// inferred once from the model tag.
//
// Pure and dependency-free so both the server (running the test) and the client
// (rendering the results) share one definition, and it stays unit testable.

export type AiWorkflowKey = "smoke" | "weekly_report" | "manual";

export interface AiWorkflowCheck {
  label: string;
  ok: boolean;
  /** What we looked for / what we saw, e.g. "found 3 of 4 required headings". */
  detail: string;
}

export interface AiWorkflowDef {
  key: AiWorkflowKey;
  label: string;
  /** One-line explanation shown under the button. */
  description: string;
  /** Suitability requirement this workflow maps to, when there is one. */
  requirementKey: "reports" | "manuals" | null;
  system: string;
  user: string;
  /** Output cap for the probe — enough to judge shape without a long wait. */
  maxTokens: number;
  /** Checks applied to the reply text. */
  grade: (reply: string) => AiWorkflowCheck[];
}

const SAMPLE_TASKS = [
  "Grease loader pins — done Mon, 40 min, tractor #4",
  "Order steel doors for the north barn — waiting on quote from Miller Supply",
  "Replace pressure switch on the well pump — done Tue, well house, 2 h",
  "Mow the north field — 6 acres, done Wed, 3.5 h on the Kubota",
  "Fence repair at the creek crossing — 60 ft of woven wire, done Wed",
  "Rachio zone 3 valve sticking — diagnosed Thu, needs a new solenoid",
  "Hay delivery: 42 square bales into the upper loft — Thu",
  "Oil change on the skid steer at 512 hours — done Fri",
  "Chimney inspection for the farmhouse wood stove — scheduled next week",
  "Weather: 3 days above 92°F, 0.4 in rain Wednesday night",
  "Chicken coop door spring broke — temporary bungee fitted, needs a real fix",
  "Septic pump alarm sounded Friday night — reset, watching it",
  "Bought 2 solenoids, 1 pressure switch, 200 ft woven wire — $412 total",
  "Diesel: 60 gal delivered Friday, tank at 80%",
  "Tomato beds side-dressed with compost — Saturday morning",
];

const WEEKLY_REPORT_HEADINGS = ["Summary", "Completed", "Blocked", "Next week"];

function countMatches(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

export const AI_WORKFLOW_TESTS: AiWorkflowDef[] = [
  {
    key: "smoke",
    label: "Connection",
    description: "Proves the endpoint, key, and model answer at all.",
    requirementKey: null,
    system: "Reply with a single short sentence.",
    user: "Say 'AI test OK' and nothing else.",
    maxTokens: 32,
    grade: (reply) => [
      {
        label: "Replied with text",
        ok: reply.trim().length > 0,
        detail: reply.trim().length > 0 ? `${reply.trim().length} characters` : "empty reply",
      },
    ],
  },
  {
    key: "weekly_report",
    label: "Weekly report",
    description:
      "Feeds a full week of task lines through and checks the model returns a structured rollup instead of claiming nothing happened.",
    requirementKey: "reports",
    system:
      "You are a farm operations assistant. You write concise weekly reports from raw task logs. " +
      "Always use these markdown headings, in order: ## Summary, ## Completed, ## Blocked, ## Next week. " +
      "Never say there is no data when task lines are provided.",
    user:
      "Write the weekly report for these logged items (week of Aug 17–23):\n\n" +
      SAMPLE_TASKS.map((t) => `- ${t}`).join("\n") +
      "\n\nUse the four required headings. List at least four completed items by name " +
      "under ## Completed and at least one blocked item under ## Blocked. Keep it under 300 words.",
    maxTokens: 900,
    grade: (reply) => {
      const found = WEEKLY_REPORT_HEADINGS.filter((h) =>
        new RegExp(`^#{1,4}\\s*${h}\\b`, "im").test(reply),
      );
      const bullets = countMatches(reply, /^\s*[-*]\s+\S/gm);
      const namedTasks = ["loader pins", "pressure switch", "north field", "fence", "oil change"]
        .filter((t) => reply.toLowerCase().includes(t));
      const deniedData =
        /\b(no (tasks|data|entries|activity|items)|nothing (was )?(logged|recorded|happened)|there (is|are) no)\b/i.test(
          reply,
        );

      return [
        {
          label: "All four sections present",
          ok: found.length === WEEKLY_REPORT_HEADINGS.length,
          detail: `found ${found.length} of ${WEEKLY_REPORT_HEADINGS.length}: ${found.join(", ") || "none"}`,
        },
        {
          label: "Itemised the week",
          ok: bullets >= 4,
          detail: `${bullets} bullet line(s)`,
        },
        {
          label: "Referenced real tasks",
          ok: namedTasks.length >= 3,
          detail: namedTasks.length ? `matched: ${namedTasks.join(", ")}` : "no input tasks echoed",
        },
        {
          label: "Did not claim the week was empty",
          ok: !deniedData,
          detail: deniedData
            ? "reply says there was no data — the input was almost certainly truncated"
            : "no empty-week claim",
        },
      ];
    },
  },
  {
    key: "manual",
    label: "Manual generation",
    description:
      "Asks for a full procedure with numbered steps, tools, and safety notes — the job that needs the most context and parameters.",
    requirementKey: "manuals",
    system:
      "You are a technical writer producing maintenance procedures for a working farm. " +
      "Every procedure has these markdown headings: ## Tools, ## Safety, ## Steps, ## Verification. " +
      "Steps are numbered and each step is a single imperative instruction.",
    user:
      "Write the procedure for replacing the pressure switch on a shallow-well jet pump " +
      "(120 gal pressure tank, 30/50 psi cut-in/cut-out, well house on a 20 A breaker).\n\n" +
      "Requirements: list at least 4 tools, at least 2 safety warnings, at least 8 numbered " +
      "steps covering power isolation, draining, swapping the switch, and repressurising, " +
      "and a verification section with the expected gauge readings.",
    maxTokens: 1400,
    grade: (reply) => {
      const headings = ["Tools", "Safety", "Steps", "Verification"].filter((h) =>
        new RegExp(`^#{1,4}\\s*${h}\\b`, "im").test(reply),
      );
      const steps = countMatches(reply, /^\s*\d+[.)]\s+\S/gm);
      const words = reply.trim().split(/\s+/).filter(Boolean).length;
      const mentionsPower = /(breaker|power|disconnect|de-?energ|lock ?out)/i.test(reply);

      return [
        {
          label: "All four sections present",
          ok: headings.length === 4,
          detail: `found ${headings.length} of 4: ${headings.join(", ") || "none"}`,
        },
        {
          label: "At least 8 numbered steps",
          ok: steps >= 8,
          detail: `${steps} numbered step(s)`,
        },
        {
          label: "Long enough to be a real procedure",
          ok: words >= 180,
          detail: `${words} words`,
        },
        {
          label: "Covered power isolation",
          ok: mentionsPower,
          detail: mentionsPower ? "breaker/lockout mentioned" : "no power-isolation language",
        },
      ];
    },
  },
];

export function getWorkflow(key: string): AiWorkflowDef {
  const hit = AI_WORKFLOW_TESTS.find((w) => w.key === key);
  if (!hit) throw new Error(`Unknown AI workflow test: ${key}`);
  return hit;
}

/** Mechanical grade of a reply: every check must pass. */
export function gradeWorkflow(key: AiWorkflowKey, reply: string | null | undefined) {
  const checks = getWorkflow(key).grade(reply ?? "");
  return { checks, passed: checks.every((c) => c.ok) };
}

/** Characters sent to the model, for token estimation in truncation math. */
export function workflowPromptChars(def: AiWorkflowDef): number {
  return def.system.length + def.user.length;
}
