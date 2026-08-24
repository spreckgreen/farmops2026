// Import template for AI-written service manuals.
//
// Workflow this supports:
//   1. Pick an asset in inventory (e.g. "Kubota L2501", 103 miles).
//   2. Copy the prompt below into any AI (ChatGPT, Claude, a local model) and
//      get back a long-form service manual.
//   3. Paste that manual into /maintenance/import-manual, which extracts the
//      service intervals + required parts and writes them to the asset.
//
// Pure module: no server or browser APIs, so the route, the server function,
// and tests all share the exact same wording.

export interface ManualPromptContext {
  assetName: string;
  category?: string | null;
  usageTracking?: string | null;
  currentHours?: number | null;
  currentMiles?: number | null;
  usageContext?: string | null;
}

/** Human-readable usage line, e.g. "103 miles" or "412 hours". */
export function usageLabel(ctx: ManualPromptContext): string {
  const hours = Number(ctx.currentHours ?? 0);
  const miles = Number(ctx.currentMiles ?? 0);
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} hours`);
  if (miles > 0) parts.push(`${miles} miles`);
  return parts.length > 0 ? parts.join(" / ") : "new (no recorded usage)";
}

/**
 * The prompt the user hands to an AI. Deliberately mirrors the long-form
 * report style people already get back ("Kubota L2501 Service Manual for a
 * Tractor at 103 Miles") while pinning down the two sections the importer
 * relies on: a service-interval list and a parts list with quantities.
 */
export function serviceManualPrompt(ctx: ManualPromptContext): string {
  const name = ctx.assetName.trim() || "this asset";
  const usage = usageLabel(ctx);
  return `Write a complete service manual for my ${name}${
    ctx.category ? ` (${ctx.category})` : ""
  } at ${usage}.

Use this structure and keep the headings exactly as written:

# ${name} Service Manual at ${usage}

## Introduction
What this machine is, its service philosophy, and why the current usage point matters.

## Service Intervals
For EVERY recurring service, use this exact bullet shape so it can be imported:

- Service: <short service name, e.g. Engine oil and filter change>
  Interval: every <number> <hours|miles|months>
  Tasks: <semicolon-separated short imperative steps>
  Parts: <part name> x <quantity> <unit>; <part name> x <quantity> <unit>
  Notes: <fluid specs, capacities, torque values, or "none">

Include the initial break-in services as well as the ongoing ones, and state
real capacities and part specifications wherever you know them (e.g. "SAE
15W-40, 3.7 qt", "Kubota Super UDT2").

## Seasonal and Annual Maintenance
Same bullet shape as above, for anything driven by the calendar.

## Troubleshooting and Common Issues
Symptom → likely cause → action.

## Recommended Tools and Consumables
Bulleted list with quantities where it matters.

## Safety Precautions
Short bulleted list.

## References
Cite the manuals, forums, or vendor pages you used, one per line.
${ctx.usageContext ? `\nHow I use it: ${ctx.usageContext.trim()}\n` : ""}`;
}

/** Blank markdown skeleton, for users who want to write a manual by hand. */
export const SERVICE_MANUAL_TEMPLATE = `# <Asset name> Service Manual at <usage>

## Introduction
<what this machine is, and why this usage point matters>

## Service Intervals

- Service: Engine oil and filter change
  Interval: every 100 hours
  Tasks: Warm the engine; drain oil; replace filter; refill and check level
  Parts: Engine oil filter x 1 each; SAE 15W-40 engine oil x 4 qt
  Notes: First change at 50 hours during break-in

- Service: Hydraulic fluid and filter
  Interval: every 300 hours
  Tasks: Drain fluid; replace filter; refill; check for leaks
  Parts: Hydraulic filter x 1 each; Super UDT2 hydraulic fluid x 6 qt
  Notes: First change at 50 hours

## Seasonal and Annual Maintenance

- Service: Fuel system winterization
  Interval: every 12 months
  Tasks: Add stabilizer; fill tank; run engine to circulate
  Parts: Diesel fuel stabilizer x 1 bottle
  Notes: Before prolonged storage

## Troubleshooting and Common Issues
- <symptom> — <likely cause> — <action>

## Recommended Tools and Consumables
- <tool or consumable> x <quantity>

## Safety Precautions
- <precaution>

## References
- <source>
`;

export function manualTemplateFileName(assetName: string): string {
  const slug =
    assetName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "asset";
  return `service-manual-template-${slug}.md`;
}
