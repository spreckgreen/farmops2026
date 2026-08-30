// Canonical naming standards for FarmOps-native infrastructure entities:
// equipment racks, power distribution assets, network devices and powered
// devices.
//
// This module is the SINGLE source of truth. The Standards page, the create /
// edit forms, the stable-ID validators, the QA / Source-of-Record checks and
// the ID generation helpers all read from here — no component may re-declare a
// naming rule locally.
//
// It deliberately has no imports from `electrical.ts` so that `electrical.ts`
// can consume it without a cycle.

export type InfrastructureKind = "rack" | "power_asset" | "device";

// ---------------------------------------------------------------- vocabularies

/** Controlled location codes used inside infrastructure stable IDs. */
export const SITE_CODES: Record<string, string> = {
  FS: "Farm Shop",
  PH: "Pump House",
  BLR: "Boiler Room",
  HSE: "House",
  SITE: "Site / exterior (no single building)",
};

/** Controlled infrastructure role classes for racks and power assets. */
export const INFRA_ROLE_CODES: Record<string, string> = {
  NET: "Network / data",
  HAM: "Amateur (ham) radio",
  SERVER: "Servers / compute",
  AV: "Audio / video",
  CONTROL: "Controls / automation",
  SEC: "Security / surveillance",
};

/** Controlled network device type tokens (`NET-<TYPE>-<SITE>-##`). */
export const NETWORK_DEVICE_TYPES: Record<string, string> = {
  SW: "Switch",
  RTR: "Router",
  AP: "Wireless access point",
  FW: "Firewall",
  BR: "Bridge",
  ONT: "Fiber / ISP termination (ONT)",
};

/** Controlled power distribution asset type tokens (`PWR-<TYPE>-…`). */
export const POWER_ASSET_ID_TYPES: Record<string, string> = {
  PDU: "AC/DC power distribution unit",
  PSU: "Shared power supply",
  UPS: "Uninterruptible power supply",
  CONV: "Converter",
  CHG: "Charger",
};

/** Legacy power asset prefixes kept valid for pre-existing records only. */
export const LEGACY_POWER_ASSET_TYPES = ["PSU", "UPS", "PDU", "DCD"] as const;

/** Controlled classes for durable powered-device roles (`DEV-<CLASS>-…`). */
export const DEVICE_CLASS_CODES: Record<string, string> = {
  HAM: "Amateur (ham) radio",
  NET: "Network / data",
  SEC: "Security / surveillance",
  CONTROL: "Controls / automation",
  AV: "Audio / video",
};

const list = (map: Record<string, string>) => Object.keys(map).join(", ");

// ------------------------------------------------------------------- standards

export interface IdToken {
  token: string;
  meaning: string;
  /** Allowed values, when the token is a controlled vocabulary. */
  values?: Record<string, string>;
}

export interface IdFormat {
  /** Human name, e.g. "Network device role ID". */
  name: string;
  shape: string;
  pattern: RegExp;
  examples: string[];
  tokens: IdToken[];
}

export interface InfrastructureIdStandard {
  kind: InfrastructureKind;
  label: string;
  /** One or more accepted canonical formats, in preference order. */
  formats: IdFormat[];
  /** Shapes accepted on existing records only (never renamed, never created). */
  legacyFormats?: IdFormat[];
  assignment: "user-assigned" | "system-generated";
  assignmentNote: string;
  /** Why the ID is durable across physical replacement. */
  stabilityNote: string;
}

const SEQ_TOKEN: IdToken = {
  token: "##",
  meaning: "Two-digit sequence within that site/role, starting at 01",
};

const SITE_TOKEN: IdToken = {
  token: "<SITE>",
  meaning: `Controlled location code (${list(SITE_CODES)})`,
  values: SITE_CODES,
};

export const INFRASTRUCTURE_ID_STANDARDS: Record<
  InfrastructureKind,
  InfrastructureIdStandard
> = {
  rack: {
    kind: "rack",
    label: "Equipment rack",
    assignment: "user-assigned",
    assignmentNote:
      "You assign the rack ID; the next free sequence number is suggested automatically once the site and role are chosen.",
    stabilityNote:
      "The rack ID is permanent. Replacing the physical rack, or linking it to a different Inventory Asset, never renames RACK-FS-NET-01.",
    formats: [
      {
        name: "Equipment rack",
        shape: "RACK-<SITE>-<ROLE>-##",
        pattern: /^RACK-([A-Z0-9]+)-([A-Z0-9]+)-(\d{2})$/,
        examples: ["RACK-FS-NET-01", "RACK-FS-HAM-01", "RACK-PH-NET-01"],
        tokens: [
          { token: "RACK", meaning: "Fixed prefix — the record is an equipment rack" },
          SITE_TOKEN,
          {
            token: "<ROLE>",
            meaning: `Controlled infrastructure class (${list(INFRA_ROLE_CODES)})`,
            values: INFRA_ROLE_CODES,
          },
          SEQ_TOKEN,
        ],
      },
    ],
  },
  power_asset: {
    kind: "power_asset",
    label: "Power distribution asset",
    assignment: "user-assigned",
    assignmentNote:
      "You assign the power asset ID. The TYPE token is a readability aid only — the typed Asset type field remains authoritative.",
    stabilityNote:
      "Swapping the physical UPS, PDU or DC supply never renames PWR-PSU-FS-HAM-01, so rack and device topology survives replacement.",
    formats: [
      {
        name: "Power distribution asset",
        shape: "PWR-<TYPE>-<SITE>-<ROLE>-##",
        pattern: /^PWR-([A-Z0-9]+)-([A-Z0-9]+)-([A-Z0-9]+)-(\d{2})$/,
        examples: ["PWR-PDU-FS-NET-01", "PWR-PSU-FS-HAM-01", "PWR-UPS-FS-NET-01"],
        tokens: [
          { token: "PWR", meaning: "Fixed prefix — the record distributes or conditions power" },
          {
            token: "<TYPE>",
            meaning: `Controlled power asset type (${list(POWER_ASSET_ID_TYPES)})`,
            values: POWER_ASSET_ID_TYPES,
          },
          SITE_TOKEN,
          {
            token: "<ROLE>",
            meaning: `Controlled infrastructure class served (${list(INFRA_ROLE_CODES)})`,
            values: INFRA_ROLE_CODES,
          },
          SEQ_TOKEN,
        ],
      },
    ],
    legacyFormats: [
      {
        name: "Pre-standard power asset",
        shape: "PSU|UPS|PDU|DCD-<SITE>-<ROLE>-##",
        pattern: /^(PSU|UPS|PDU|DCD)-([A-Z0-9]+)-([A-Z0-9]+)-(\d{2})$/,
        examples: ["PSU-FS-HAM-01", "UPS-FS-NET-01"],
        tokens: [],
      },
    ],
  },
  device: {
    kind: "device",
    label: "Device",
    assignment: "user-assigned",
    assignmentNote:
      "You assign the device ID. Create a device record when its power dependency or topology matters operationally — ordinary inventory items do not need one.",
    stabilityNote:
      "The ID names the operational role, not the hardware: replacing the physical switch keeps NET-SW-PH-01 and rebuilds no topology. The linked Inventory Asset owns manufacturer, model, serial, warranty and service history.",
    formats: [
      {
        name: "Network device role ID",
        shape: "NET-<TYPE>-<SITE>-##",
        pattern: /^NET-([A-Z0-9]+)-([A-Z0-9]+)-(\d{2})$/,
        examples: ["NET-SW-FS-01", "NET-SW-PH-01", "NET-AP-HSE-01"],
        tokens: [
          { token: "NET", meaning: "Fixed prefix — a network-role device" },
          {
            token: "<TYPE>",
            meaning: `Controlled network device type (${list(NETWORK_DEVICE_TYPES)})`,
            values: NETWORK_DEVICE_TYPES,
          },
          SITE_TOKEN,
          SEQ_TOKEN,
        ],
      },
      {
        name: "Powered device role ID",
        shape: "DEV-<CLASS>-<ROLE>-<SITE>-##",
        pattern: /^DEV-([A-Z0-9]+)-([A-Z0-9]+)-([A-Z0-9]+)-(\d{2})$/,
        examples: ["DEV-HAM-RADIO-FS-01", "DEV-NET-SERVER-FS-01", "DEV-NET-NVR-FS-01"],
        tokens: [
          { token: "DEV", meaning: "Fixed prefix — a powered device whose topology matters" },
          {
            token: "<CLASS>",
            meaning: `Controlled device class (${list(DEVICE_CLASS_CODES)})`,
            values: DEVICE_CLASS_CODES,
          },
          {
            token: "<ROLE>",
            meaning: "Operational role word, e.g. RADIO, SERVER, NVR, CAMERA",
          },
          SITE_TOKEN,
          SEQ_TOKEN,
        ],
      },
    ],
    legacyFormats: [
      {
        name: "Pre-standard powered device ID",
        // The only historical Powered Device IDs FarmOps needs to preserve use
        // the SW (switch) role prefix with a short site code and a simple
        // sequence, e.g. SW-FS-1. Anything else — including plausible-looking
        // prefixes such as NETWORK-SW-FS-01 — is an invalid ID, not a
        // compatibility case. Do not widen this allow-list without a real
        // pre-existing record that requires it.
        shape: "SW-<SITE>-<n>",
        pattern: /^SW-([A-Z0-9]+)-(\d+)$/,
        examples: ["SW-FS-1"],
        tokens: [
          { token: "SW", meaning: "Fixed historical prefix — a pre-standard switch-role device" },
          SITE_TOKEN,
          { token: "<n>", meaning: "Historical sequence number (one or more digits, not zero-padded)" },
        ],
      },
    ],
  },
};

/** Regexes exposed for the shared ID_PATTERNS table in `electrical.ts`. */
export function canonicalInfrastructurePattern(kind: InfrastructureKind): RegExp {
  const parts = INFRASTRUCTURE_ID_STANDARDS[kind].formats.map((f) => f.pattern.source);
  return new RegExp(`(?:${parts.join("|")})`);
}

export function legacyInfrastructurePattern(kind: InfrastructureKind): RegExp | null {
  const formats = INFRASTRUCTURE_ID_STANDARDS[kind].legacyFormats ?? [];
  if (!formats.length) return null;
  return new RegExp(`(?:${formats.map((f) => f.pattern.source).join("|")})`);
}

export function infrastructureShape(kind: InfrastructureKind): string {
  return INFRASTRUCTURE_ID_STANDARDS[kind].formats.map((f) => f.shape).join(" or ");
}

// ------------------------------------------------------------------ validation

export interface InfrastructureIdCheck {
  ok: boolean;
  error?: string;
  warning?: string;
  /** Which canonical format matched, when one did. */
  format?: IdFormat;
}

/** Token positions that are controlled vocabularies, per format. */
function controlledTokenValues(format: IdFormat): (Record<string, string> | null)[] {
  return format.tokens
    .filter((t) => t.token.startsWith("<"))
    .map((t) => t.values ?? null);
}

function tokenLabels(format: IdFormat): string[] {
  return format.tokens.filter((t) => t.token.startsWith("<")).map((t) => t.token);
}

/**
 * Validate an infrastructure stable ID with actionable messages: every failure
 * says what is wrong and shows a compliant example instead of "invalid ID".
 */
export function checkInfrastructureId(
  kind: InfrastructureKind,
  raw: string,
  opts: { mode?: "create" | "existing" } = {},
): InfrastructureIdCheck {
  const std = INFRASTRUCTURE_ID_STANDARDS[kind];
  const id = (raw ?? "").trim();
  const example = std.formats[0].examples[0];
  if (!id) {
    return {
      ok: false,
      error: `A ${std.label.toLowerCase()} ID is required — use ${infrastructureShape(kind)}, e.g. ${example}.`,
    };
  }
  if (/\s/.test(id)) {
    return { ok: false, error: `Stable IDs cannot contain spaces. Example: ${example}.` };
  }
  if (id !== id.toUpperCase()) {
    return {
      ok: false,
      error: `${id} must be upper case — use ${id.toUpperCase()} (format ${infrastructureShape(kind)}, e.g. ${example}).`,
    };
  }

  for (const format of std.formats) {
    const m = format.pattern.exec(id);
    if (!m) continue;
    const captured = m.slice(1);
    const controlled = controlledTokenValues(format);
    const labels = tokenLabels(format);
    for (let i = 0; i < controlled.length; i++) {
      const allowed = controlled[i];
      const value = captured[i];
      if (!allowed || !value) continue;
      if (!(value in allowed)) {
        return {
          ok: false,
          error: `${id} uses "${value}" for ${labels[i]}, which is not an approved value. Allowed: ${list(allowed)}. Compliant example: ${example}.`,
        };
      }
    }
    return { ok: true, format };
  }

  // Legacy shapes: valid on existing records, refused for new ones.
  for (const legacy of std.legacyFormats ?? []) {
    if (!legacy.pattern.test(id)) continue;
    if (opts.mode === "create") {
      return {
        ok: false,
        error: `${id} uses the pre-standard ${legacy.shape} shape, which is compatibility-only for records that already exist. New records must use ${infrastructureShape(kind)} — e.g. ${example}.`,
      };
    }
    return {
      ok: true,
      warning: `${id} predates the ${infrastructureShape(kind)} convention. Existing IDs are never renamed, but new ${std.label.toLowerCase()} records must use the current format — e.g. ${example}.`,
    };
  }

  const prefix = id.split("-", 1)[0];
  if (kind === "device" && prefix && prefix !== "NET" && prefix !== "DEV") {
    return {
      ok: false,
      error: `${id} has an invalid prefix "${prefix}" — powered devices use NET- (network roles) or DEV- (powered roles); only the historical SW-<SITE>-<n> shape (e.g. SW-FS-1) is compatibility-only for records that already exist. Compliant example: ${example}.`,
    };
  }
  return {
    ok: false,
    error: `${id} does not match the required ${std.label.toLowerCase()} format ${infrastructureShape(kind)}. ${describeShapeTokens(kind)} Compliant example: ${example}.`,
  };
}

function describeShapeTokens(kind: InfrastructureKind): string {
  const format = INFRASTRUCTURE_ID_STANDARDS[kind].formats[0];
  return format.tokens.map((t) => `${t.token} = ${t.meaning}`).join("; ") + ".";
}

/**
 * Plain-language reading of a compliant ID, used as form helper text:
 * `NET-SW-PH-01` → "Network switch role, Pump House, sequence 01".
 */
export function describeInfrastructureId(kind: InfrastructureKind, raw: string): string | null {
  const id = (raw ?? "").trim().toUpperCase();
  if (!id) return null;
  for (const format of INFRASTRUCTURE_ID_STANDARDS[kind].formats) {
    const m = format.pattern.exec(id);
    if (!m) continue;
    const captured = m.slice(1);
    const tokens = format.tokens.filter((t) => t.token.startsWith("<"));
    const parts: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const value = captured[i] ?? "";
      if (token.token === "##") continue;
      if (token.values && value in token.values) parts.push(token.values[value]);
      else if (value) parts.push(value);
    }
    const seq = captured[captured.length - 1];
    parts.push(`sequence ${seq}`);
    return parts.join(", ");
  }
  return null;
}

// ------------------------------------------------------------------ generation

function nextSequence(prefixWithDash: string, existing: string[]): string {
  let max = 0;
  const re = new RegExp(`^${prefixWithDash.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}(\\d{2,})$`);
  for (const id of existing) {
    const m = re.exec((id ?? "").trim().toUpperCase());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return String(max + 1).padStart(2, "0");
}

const clean = (v: string) => (v ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

export function buildRackId(site: string, role: string, existing: string[] = []): string {
  const s = clean(site);
  const r = clean(role);
  if (!s || !r) return "";
  const head = `RACK-${s}-${r}-`;
  return `${head}${nextSequence(head, existing)}`;
}

export function buildNetworkDeviceId(type: string, site: string, existing: string[] = []): string {
  const t = clean(type);
  const s = clean(site);
  if (!t || !s) return "";
  const head = `NET-${t}-${s}-`;
  return `${head}${nextSequence(head, existing)}`;
}

export function buildPoweredDeviceId(
  deviceClass: string,
  role: string,
  site: string,
  existing: string[] = [],
): string {
  const c = clean(deviceClass);
  const r = clean(role);
  const s = clean(site);
  if (!c || !r || !s) return "";
  const head = `DEV-${c}-${r}-${s}-`;
  return `${head}${nextSequence(head, existing)}`;
}

export function buildPowerAssetId(
  type: string,
  site: string,
  role: string,
  existing: string[] = [],
): string {
  const t = clean(type);
  const s = clean(site);
  const r = clean(role);
  if (!t || !s || !r) return "";
  const head = `PWR-${t}-${s}-${r}-`;
  return `${head}${nextSequence(head, existing)}`;
}

/** Type guard so UI code can ask "does this kind use an infrastructure ID?". */
export function isInfrastructureIdKind(kind: string): kind is InfrastructureKind {
  return kind === "rack" || kind === "power_asset" || kind === "device";
}
