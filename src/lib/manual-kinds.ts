// The three manual types you can generate + import for one asset.
//
//   service_schedule → parsed into maintenance records + inventory parts
//                      (the original importer in service-manual-import.functions.ts)
//   operator         → saved as a procedure document linked to the asset
//   workshop         → same, but deep repair / teardown detail
//
// Pure module (no server or browser APIs) so route, server fn, and tests share
// the exact same prompt wording.
import { serviceManualPrompt, usageLabel, type ManualPromptContext } from "./service-manual-template";

export type ManualKind = "service_schedule" | "operator" | "workshop";

export const MANUAL_KINDS: ManualKind[] = ["service_schedule", "operator", "workshop"];

export interface ManualKindMeta {
  kind: ManualKind;
  label: string;
  /** One-liner for the picker. */
  blurb: string;
  /** What importing this kind actually writes into Bostead. */
  outcome: string;
  /** "records" = maintenance records + parts, "document" = a procedure page. */
  target: "records" | "document";
}

export const MANUAL_KIND_META: Record<ManualKind, ManualKindMeta> = {
  service_schedule: {
    kind: "service_schedule",
    label: "Service schedule",
    blurb: "Intervals, tasks, and the parts each service consumes.",
    outcome:
      "Each interval becomes a maintenance record on the asset, and missing parts are created in inventory.",
    target: "records",
  },
  operator: {
    kind: "operator",
    label: "Operator manual",
    blurb: "Daily operation: controls, pre-start checks, safe running limits.",
    outcome:
      "Saved as a procedure page (e.g. \"Kubota L2501 — Operator manual\") and linked to the asset.",
    target: "document",
  },
  workshop: {
    kind: "workshop",
    label: "Workshop manual",
    blurb: "Repair-level detail: torque specs, teardown steps, diagnostics.",
    outcome:
      "Saved as a procedure page (e.g. \"Kubota L2501 — Workshop manual\") and linked to the asset.",
    target: "document",
  },
};

/** Default procedure name for a document-style manual. */
export function manualProcedureName(assetName: string, kind: ManualKind): string {
  const base = (assetName || "Asset").trim().replace(/[\/\\<>:"|?*]/g, "-");
  const suffix = kind === "workshop" ? "Workshop manual" : "Operator manual";
  return `${base} — ${suffix}`.slice(0, 120);
}

function operatorPrompt(ctx: ManualPromptContext): string {
  const name = ctx.assetName.trim() || "this asset";
  const usage = usageLabel(ctx);
  return `Write a complete OPERATOR manual for my ${name}${
    ctx.category ? ` (${ctx.category})` : ""
  } at ${usage}.

Write it as clean Markdown with these headings, in this order:

# ${name} Operator Manual

## Overview
What the machine is, its rated capacities, and who should operate it.

## Controls and Instruments
One bullet per control: what it is, where it is, and what it does.

## Pre-Start Checks
Numbered checklist done before every start (fluids, tire/track condition, guards).

## Starting and Shutdown
Numbered steps for a cold start, a warm start, and a correct shutdown.

## Normal Operation
How to run it well: gear/PTO/RPM ranges, load limits, terrain and slope limits.

## Attachments and Hitching
Steps for attaching, unhitching, and matching implements to this machine.

## Daily and Weekly Operator Care
Short checklist the operator (not a shop) is responsible for.

## Storage and Transport
Tie-down points, fuel/battery handling, short- and long-term storage.

## Troubleshooting for Operators
Symptom → likely cause → what the operator should do (and when to stop and call a shop).

## Safety
Bulleted list of the real hazards on this machine.

## References
Cite the manuals, forums, or vendor pages you used, one per line.
${ctx.usageContext ? `\nHow I use it: ${ctx.usageContext.trim()}\n` : ""}`;
}

function workshopPrompt(ctx: ManualPromptContext): string {
  const name = ctx.assetName.trim() || "this asset";
  const usage = usageLabel(ctx);
  return `Write a complete WORKSHOP (repair) manual for my ${name}${
    ctx.category ? ` (${ctx.category})` : ""
  } at ${usage}.

Write it as clean Markdown with these headings, in this order:

# ${name} Workshop Manual

## Specifications
Table of engine, drivetrain, hydraulic, and electrical specs with real numbers.

## Fluids and Capacities
Table: system, fluid spec, capacity, change interval.

## Torque Specifications
Table: fastener, size, torque value (ft-lb and Nm).

## Special Tools
Bulleted list with part numbers where you know them.

## Diagnostics
Per system: symptom, test procedure, expected reading, pass/fail action.

## Repair Procedures
For each major job use this shape:

### <Job name>
Difficulty: <easy|moderate|shop only>
Tools: <list>
Parts: <part name> x <quantity> <unit>
Steps:
1. <step>
2. <step>
Torque and specs: <values>
Notes: <cautions, break-in, sealant, alignment>

## Wiring and Hydraulic Notes
Connector/valve identification and anything that commonly gets mis-assembled.

## Safety
Stored-energy hazards: hydraulics, springs, batteries, fuel, hot surfaces.

## References
Cite the manuals, forums, or vendor pages you used, one per line.
${ctx.usageContext ? `\nHow I use it: ${ctx.usageContext.trim()}\n` : ""}`;
}

/** The prompt to hand an AI for the chosen manual kind. */
export function manualPrompt(kind: ManualKind, ctx: ManualPromptContext): string {
  if (kind === "operator") return operatorPrompt(ctx);
  if (kind === "workshop") return workshopPrompt(ctx);
  return serviceManualPrompt(ctx);
}

export const OPERATOR_MANUAL_TEMPLATE = `# <Asset name> Operator Manual

## Overview
<what it is, rated capacities>

## Controls and Instruments
- <control> — <location> — <what it does>

## Pre-Start Checks
1. <check>

## Starting and Shutdown
1. <step>

## Normal Operation
- <RPM / gear / load guidance>

## Attachments and Hitching
1. <step>

## Daily and Weekly Operator Care
- <task>

## Storage and Transport
- <note>

## Troubleshooting for Operators
- <symptom> — <cause> — <action>

## Safety
- <hazard>

## References
- <source>
`;

export const WORKSHOP_MANUAL_TEMPLATE = `# <Asset name> Workshop Manual

## Specifications
| System | Spec |
| --- | --- |
| Engine | <spec> |

## Fluids and Capacities
| System | Fluid | Capacity | Interval |
| --- | --- | --- | --- |
| Engine oil | <spec> | <qt> | <hours> |

## Torque Specifications
| Fastener | Size | Torque |
| --- | --- | --- |
| <fastener> | <size> | <ft-lb / Nm> |

## Special Tools
- <tool> (<part number>)

## Diagnostics
- <symptom> — <test> — <expected> — <action>

## Repair Procedures

### <Job name>
Difficulty: moderate
Tools: <list>
Parts: <part> x 1 each
Steps:
1. <step>
Torque and specs: <values>
Notes: <caution>

## Wiring and Hydraulic Notes
- <note>

## Safety
- <hazard>

## References
- <source>
`;

export function manualTemplateFor(kind: ManualKind): string | null {
  if (kind === "operator") return OPERATOR_MANUAL_TEMPLATE;
  if (kind === "workshop") return WORKSHOP_MANUAL_TEMPLATE;
  return null; // service schedule uses SERVICE_MANUAL_TEMPLATE
}
