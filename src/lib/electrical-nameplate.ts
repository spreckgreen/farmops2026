// Nameplate photo extraction: the field list and the tolerant JSON reader.
//
// Pure module so the prompt, the parser and the review table always agree on
// the same field set, and so parsing is unit-testable without an AI call.
//
// The model is asked for one JSON object keyed by these ids, e.g.
//   { "voltage": "240", "phase": "1", "fla": "12.4", "model": "SUZ-KA18NAHZ",
//     "serial": null, "notes": "MOCP digit obscured by grease" }
// Anything it cannot read must come back null — never a guess.

export interface NameplateFieldDef {
  id: string;
  label: string;
  /** Shown under the value so an electrician knows what was asked for. */
  hint: string;
}

export const NAMEPLATE_FIELDS: readonly NameplateFieldDef[] = [
  { id: "manufacturer", label: "Manufacturer", hint: "Brand as printed, e.g. Mitsubishi" },
  { id: "model", label: "Model", hint: "Model / catalog number, e.g. SUZ-KA18NAHZ" },
  { id: "serial", label: "Serial", hint: "Serial number, exactly as printed" },
  { id: "voltage", label: "Voltage", hint: "Rated volts, e.g. 240 or 208-230" },
  { id: "phase", label: "Phase", hint: "1 or 3" },
  { id: "hz", label: "Frequency", hint: "Hz, e.g. 60" },
  { id: "fla", label: "FLA / RLA", hint: "Full- or rated-load amps" },
  { id: "mca", label: "MCA", hint: "Minimum circuit ampacity" },
  { id: "mocp", label: "MOCP / max fuse", hint: "Max overcurrent device rating" },
  { id: "hp", label: "HP / kW", hint: "Motor rating, e.g. 1.5 HP" },
  { id: "watts", label: "Watts / VA", hint: "Connected load if printed" },
  { id: "sccr", label: "SCCR", hint: "Short-circuit current rating, e.g. 5 kA" },
  { id: "lra", label: "LRA", hint: "Locked-rotor amps, if printed" },
  { id: "notes", label: "Notes / illegible", hint: "What could not be read, and why" },
] as const;

export type NameplateDraft = Record<string, string | null>;

export interface NameplateField {
  id: string;
  label: string;
  hint: string;
  value: string | null;
}

const IDS = new Set(NAMEPLATE_FIELDS.map((f) => f.id));

function clean(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\s+/g, " ").slice(0, 200);
  if (!text) return null;
  // Models like to answer "unknown"/"n/a" instead of null; treat those as blank
  // so an unreadable plate never looks like recorded data.
  if (/^(unknown|unreadable|illegible|n\/?a|none|null|not visible|-{1,3})$/i.test(text)) {
    return null;
  }
  return text;
}

/**
 * Pull the JSON object out of a model reply and keep only known fields.
 * Tolerates ```json fences, leading prose and trailing commentary.
 */
export function parseNameplateDraft(text: string): NameplateDraft | null {
  const raw = text.trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced?.[1] ?? raw).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const draft: NameplateDraft = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const id = key.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (IDS.has(id)) draft[id] = clean(value);
  }
  return Object.keys(draft).length > 0 ? draft : null;
}

/** The full field list in display order, with whatever the model read. */
export function nameplateFields(draft: NameplateDraft | null): NameplateField[] {
  return NAMEPLATE_FIELDS.map((def) => ({
    id: def.id,
    label: def.label,
    hint: def.hint,
    value: draft ? (draft[def.id] ?? null) : null,
  }));
}

/** Accepted uploads. HEIC is excluded — models reject it; ask for JPEG/PNG. */
export const NAMEPLATE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
/** Max decoded photo size. A phone photo downscaled to 1600px is far under this. */
export const NAMEPLATE_MAX_BYTES = 6 * 1024 * 1024;

export interface ParsedDataUrl {
  mimeType: string;
  bytes: number;
}

/**
 * Validate a `data:image/jpeg;base64,...` upload before it costs an AI call.
 * Returns the real MIME type from the payload — never assume one.
 */
export function inspectNameplateDataUrl(dataUrl: string): ParsedDataUrl {
  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.trim());
  if (!match) throw new Error("Attach the photo as a base64 image data URL.");
  const mimeType = match[1]!.toLowerCase();
  if (!(NAMEPLATE_IMAGE_TYPES as readonly string[]).includes(mimeType)) {
    throw new Error(
      `${mimeType} is not supported. Use a JPEG, PNG or WebP photo (iPhone HEIC must be converted first).`,
    );
  }
  const base64 = match[2]!.replace(/\s+/g, "");
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const bytes = Math.floor((base64.length * 3) / 4) - padding;
  if (bytes <= 0) throw new Error("The photo appears to be empty.");
  if (bytes > NAMEPLATE_MAX_BYTES) {
    throw new Error(
      `That photo is ${(bytes / (1024 * 1024)).toFixed(1)} MB. Keep it under ${NAMEPLATE_MAX_BYTES / (1024 * 1024)} MB.`,
    );
  }
  return { mimeType, bytes };
}

export const NAMEPLATE_SYSTEM_PROMPT =
  "You transcribe equipment nameplates for an electrician. Read ONLY what is printed on the plate in the photo. " +
  "Never infer, convert, normalise or complete a value: if a digit is obscured, the field is null and you say so in `notes`. " +
  "Do not use typical values for the equipment type. Reply with ONE JSON object and nothing else, using exactly these keys: " +
  NAMEPLATE_FIELDS.map((f) => f.id).join(", ") +
  ". Values are strings copied from the plate, or null when not legible or not printed. " +
  "Keep units as printed (e.g. \"208-230\", \"12.4\", \"1.5 HP\", \"5 kA\"). " +
  "This is a draft for human confirmation; it writes no record.";
