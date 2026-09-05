// Shared, deterministic effective-location resolver for every FarmOps
// electrical object.
//
// This is the ONE place that decides which recorded location a map, diagram,
// list, audit preview, export, AI answer or completeness calculation displays.
// Screens must not re-implement precedence; they call resolveEffectiveLocation()
// (or an adapter below) and render its result.
//
// Precedence (highest first):
//   1. FIELD_OBSERVED_POLE_ALIGNMENT — perimeter objects only.
//   2. FIELD_OBSERVED_GRID          — accepted field observation, current A1–F9.
//   3. APPROVED_DESIGN_XY           — approved design coordinates for a planned,
//                                     pattern-generated object (e.g. FS-056..FS-065).
//                                     The exact X/Y is the location; its A1–F9 label
//                                     is a derived read-out only. Lifecycle stays
//                                     planned and the location stays unverified
//                                     until accepted field evidence supersedes it.
//   4. GRID_REMAPPED                — derived from an accepted legacy→current map.
//   5. ORIGINAL_GRID                — lowest-precision fallback.
//
// Invariants:
//   * The winner is DERIVED and READ-ONLY. Nothing is written, nothing is
//     overwritten, and every lower-priority statement is preserved verbatim with
//     its source, evidence reference, timestamp and confidence.
//   * A source may only win when it is valid and resolvable; an incomplete pole
//     reference or an invalid grid value falls through and raises a data-quality
//     warning.
//   * Perimeter membership is never inferred from a description. It comes from
//     explicit topology, wall/location classification, a pole reference in the
//     frozen scheme, or accepted field evidence.
//   * Two accepted statements at the same priority that disagree produce a
//     location conflict requiring adjudication — never an import-order pick.
import {
  SHOP_DEPTH_FT,
  SHOP_WIDTH_FT,
  oldLetterToFeet,
  oldNumberToFeet,
  parseOldGrid,
} from "@/lib/electrical-grid-migration";
import { derivedGridLabel } from "@/lib/electrical-grid-map";
import { parseNewGrid, newGridFeet } from "@/lib/electrical-grid-operational";
import { normalizePostRef, proposedPostFeet } from "@/lib/electrical-grid-post-geometry";

export const EFFECTIVE_LOCATION_VERSION = "electrical-effective-location-1";

export type EffectiveLocationSource =
  | "FIELD_OBSERVED_POLE_ALIGNMENT"
  | "FIELD_OBSERVED_GRID"
  | "APPROVED_DESIGN_XY"
  | "GRID_REMAPPED"
  | "ORIGINAL_GRID";

/** Highest priority first. Index in this array is the priority rank. */
export const EFFECTIVE_LOCATION_PRIORITY: EffectiveLocationSource[] = [
  "FIELD_OBSERVED_POLE_ALIGNMENT",
  "FIELD_OBSERVED_GRID",
  "APPROVED_DESIGN_XY",
  "GRID_REMAPPED",
  "ORIGINAL_GRID",
];

/** Short phrase used in the "location · source · evidence" provenance line. */
export const EFFECTIVE_LOCATION_SOURCE_PHRASE: Record<EffectiveLocationSource, string> = {
  FIELD_OBSERVED_POLE_ALIGNMENT: "observed pole alignment",
  FIELD_OBSERVED_GRID: "observed A1–F9 grid",
  APPROVED_DESIGN_XY: "approved design X/Y",
  GRID_REMAPPED: "remapped A1–F9 grid",
  ORIGINAL_GRID: "original grid",
};

/** Default evidence/precision word for each source. */
export const EFFECTIVE_LOCATION_EVIDENCE_WORD: Record<EffectiveLocationSource, string> = {
  FIELD_OBSERVED_POLE_ALIGNMENT: "field verified",
  FIELD_OBSERVED_GRID: "field verified",
  APPROVED_DESIGN_XY: "approved design, not field verified",
  GRID_REMAPPED: "derived",
  ORIGINAL_GRID: "fallback",
};

export type PoleLocationKindLike = "AT_POST" | "BETWEEN_POSTS" | "NOT_APPLICABLE" | string;

/**
 * One recorded location statement. Every statement supplied is preserved in the
 * result, whether or not it wins, is valid or is eligible.
 */
export interface LocationStatement {
  source: EffectiveLocationSource;
  /** Stable key for this statement, used for explicit supersede relationships. */
  id?: string | null;
  /** Raw recorded value: pole reference, grid reference, or legacy grid text. */
  value?: string | null;
  /** Pole statements only. */
  poleScheme?: string | null;
  poleLocationKind?: PoleLocationKindLike | null;
  poleRefStart?: string | null;
  poleRefEnd?: string | null;
  /** APPROVED_DESIGN_XY only: exact approved coordinates, in feet. */
  designXFt?: number | null;
  designYFt?: number | null;
  /** Evidence reference (photo, audit item, observation note). Preserved as-is. */
  evidence?: string | null;
  observedAt?: string | null;
  confidence?: string | null;
  /**
   * Observed sources must be accepted (an applied/approved observation) to be
   * eligible. Derived sources default to accepted.
   */
  accepted?: boolean | null;
  /** Ids of same-priority statements this one explicitly supersedes. */
  supersedes?: string[] | null;
}

export interface PerimeterClassification {
  onPerimeter: boolean;
  basis: string;
}

/**
 * Explicit perimeter inputs only. Descriptions are deliberately NOT accepted:
 * text such as "east wall receptacle" never makes an object a perimeter object.
 */
export interface PerimeterInput {
  /** Explicit topology classification, e.g. "PERIMETER" / "INTERIOR". */
  topologyPlacement?: string | null;
  /** Explicit wall/location classification field, e.g. "north" / "east wall". */
  wallClassification?: string | null;
  /** A pole reference recorded on the object (must exist in the frozen scheme). */
  poleReference?: string | null;
  /** Accepted field evidence that the object is mounted on the perimeter. */
  fieldEvidencePerimeter?: boolean | null;
}

const WALL_RE = /^(north|south|east|west)(\s*wall)?$/i;

export function classifyPerimeter(input: PerimeterInput): PerimeterClassification {
  const topo = (input.topologyPlacement ?? "").trim().toUpperCase();
  if (topo === "PERIMETER" || topo === "PERIMETER_WALL" || topo === "EXTERIOR_WALL")
    return { onPerimeter: true, basis: `Explicit topology classification ${topo}.` };
  if (topo === "INTERIOR" || topo === "INTERIOR_SPACE")
    return { onPerimeter: false, basis: `Explicit topology classification ${topo}.` };

  const wall = (input.wallClassification ?? "").trim();
  if (wall && WALL_RE.test(wall))
    return { onPerimeter: true, basis: `Explicit wall/location classification "${wall}".` };

  if (input.fieldEvidencePerimeter)
    return { onPerimeter: true, basis: "Accepted field evidence records a perimeter mounting." };

  const pole = normalizePostRef(input.poleReference);
  if (pole && proposedPostFeet(pole))
    return {
      onPerimeter: true,
      basis: `Recorded pole reference ${pole} exists in the frozen perimeter post scheme.`,
    };

  return {
    onPerimeter: false,
    basis: "No explicit topology, wall classification, pole reference or accepted field evidence places this object on the building perimeter.",
  };
}

export type LocationWarningCode =
  | "INVALID_SOURCE_VALUE"
  | "INCOMPLETE_POLE_REFERENCE"
  | "POLE_ALIGNMENT_NOT_ELIGIBLE"
  | "OBSERVATION_NOT_ACCEPTED"
  | "EQUAL_PRIORITY_CONFLICT"
  | "NO_RESOLVABLE_LOCATION";

export interface LocationWarning {
  code: LocationWarningCode;
  source: EffectiveLocationSource | null;
  message: string;
}

export interface ResolvedStatement {
  source: EffectiveLocationSource;
  id: string | null;
  /** Priority rank; 0 is highest. */
  rank: number;
  /** Raw recorded value, preserved verbatim. */
  raw: string | null;
  /** Human-readable location label, e.g. "A8", "Post 14SW", "Old grid C7". */
  label: string | null;
  xFt: number | null;
  yFt: number | null;
  spanned: boolean;
  /** Valid and resolvable to a location. */
  valid: boolean;
  /** Valid AND allowed to compete (e.g. pole alignment needs a perimeter object). */
  eligible: boolean;
  reason: string | null;
  evidence: string | null;
  observedAt: string | null;
  confidence: string | null;
  accepted: boolean;
  supersedes: string[];
}

export interface LocationConflict {
  source: EffectiveLocationSource;
  statements: ResolvedStatement[];
  message: string;
}

export interface EffectiveLocation {
  version: string;
  perimeter: PerimeterClassification;
  /** The derived winner, or null when nothing is resolvable / adjudication is due. */
  effective: {
    source: EffectiveLocationSource;
    label: string;
    xFt: number | null;
    yFt: number | null;
    spanned: boolean;
    evidence: string | null;
    observedAt: string | null;
    confidence: string | null;
  } | null;
  /** Every statement supplied, in priority order. Nothing is discarded. */
  statements: ResolvedStatement[];
  warnings: LocationWarning[];
  conflict: LocationConflict | null;
  requiresAdjudication: boolean;
  /** "A8 · observed A1–F9 grid · field verified" */
  provenance: string;
}

const clean = (v: unknown): string | null => {
  const t = (v == null ? "" : String(v)).trim();
  return t ? t : null;
};

function resolvePole(s: LocationStatement): {
  label: string | null;
  xFt: number | null;
  yFt: number | null;
  spanned: boolean;
  reason: string | null;
} {
  const kind = (s.poleLocationKind ?? "AT_POST").toString().trim().toUpperCase();
  if (kind === "NOT_APPLICABLE")
    return { label: null, xFt: null, yFt: null, spanned: false, reason: "Pole alignment recorded as not applicable." };
  const startRef = normalizePostRef(s.poleRefStart ?? s.value);
  const start = startRef ? proposedPostFeet(startRef) : null;
  if (!start)
    return {
      label: null,
      xFt: null,
      yFt: null,
      spanned: false,
      reason: startRef
        ? `Pole reference "${startRef}" is not in the frozen perimeter post scheme.`
        : "Pole observation names no post.",
    };
  if (kind === "BETWEEN_POSTS") {
    const endRef = normalizePostRef(s.poleRefEnd);
    const end = endRef ? proposedPostFeet(endRef) : null;
    if (!end)
      return {
        label: null,
        xFt: null,
        yFt: null,
        spanned: false,
        reason: "Between-posts observation is incomplete: the second post is missing or unknown.",
      };
    return {
      label: `Post ${start.ref}/${end.ref}`,
      xFt: (start.xFt + end.xFt) / 2,
      yFt: (start.yFt + end.yFt) / 2,
      spanned: true,
      reason: null,
    };
  }
  return { label: `Post ${start.ref}`, xFt: start.xFt, yFt: start.yFt, spanned: false, reason: null };
}

function resolveGrid(raw: string | null): {
  label: string | null;
  xFt: number | null;
  yFt: number | null;
  spanned: boolean;
  reason: string | null;
} {
  if (!raw) return { label: null, xFt: null, yFt: null, spanned: false, reason: "No grid value recorded." };
  const parsed = parseNewGrid(raw);
  if (!parsed.ok)
    return {
      label: null,
      xFt: null,
      yFt: null,
      spanned: false,
      reason: `Grid value "${raw}" is not a valid current A1–F9 reference.`,
    };
  const feet = newGridFeet(parsed);
  if (!feet)
    return {
      label: null,
      xFt: null,
      yFt: null,
      spanned: false,
      reason: `Grid value "${raw}" cannot be resolved on the current grid.`,
    };
  const label = `${parsed.rows.join("-")}${parsed.cols.join("-")}`;
  return { label, xFt: feet.xFt, yFt: feet.yFt, spanned: feet.span, reason: null };
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * Approved design coordinates. The exact approved X/Y IS the location; the A1–F9
 * label is only a human read-out of those feet, so maps and diagrams must plot
 * xFt/yFt and never rebuild coordinates from the label.
 */
function resolveDesignXy(s: LocationStatement): {
  label: string | null;
  xFt: number | null;
  yFt: number | null;
  spanned: boolean;
  reason: string | null;
} {
  const xFt = num(s.designXFt);
  const yFt = num(s.designYFt);
  if (xFt == null || yFt == null)
    return {
      label: null,
      xFt: null,
      yFt: null,
      spanned: false,
      reason: "Approved design coordinates are incomplete.",
    };
  if (xFt < 0 || xFt > SHOP_WIDTH_FT || yFt < 0 || yFt > SHOP_DEPTH_FT)
    return {
      label: null,
      xFt: null,
      yFt: null,
      spanned: false,
      reason: `Approved design coordinates ${xFt} ft E / ${yFt} ft S fall outside the frozen building envelope.`,
    };
  return { label: derivedGridLabel(xFt, yFt), xFt, yFt, spanned: false, reason: null };
}

function resolveOriginal(raw: string | null): {
  label: string | null;
  xFt: number | null;
  yFt: number | null;
  spanned: boolean;
  reason: string | null;
} {
  if (!raw) return { label: null, xFt: null, yFt: null, spanned: false, reason: "No original grid value recorded." };
  const legacy = parseOldGrid(raw);
  if (legacy.uninterpretable || legacy.letter == null || legacy.number == null)
    return {
      label: null,
      xFt: null,
      yFt: null,
      spanned: false,
      reason: `Original grid value "${raw}" is not an interpretable legacy reference.`,
    };
  const xFt = oldNumberToFeet(legacy.number);
  const yFt = oldLetterToFeet(legacy.letter);
  if (xFt == null || yFt == null)
    return {
      label: null,
      xFt: null,
      yFt: null,
      spanned: false,
      reason: `Original grid value "${raw}" falls outside the frozen legacy drawing.`,
    };
  return {
    label: `Old grid ${legacy.letter}${legacy.number}`,
    xFt,
    yFt,
    spanned: false,
    reason: null,
  };
}

const OBSERVED: EffectiveLocationSource[] = [
  "FIELD_OBSERVED_POLE_ALIGNMENT",
  "FIELD_OBSERVED_GRID",
];

const TOLERANCE_FT = 0.5;

export interface ResolveEffectiveLocationInput {
  stableId?: string | null;
  perimeter?: PerimeterInput | PerimeterClassification | null;
  statements: LocationStatement[];
}

function asClassification(
  p: ResolveEffectiveLocationInput["perimeter"],
  statements: LocationStatement[],
): PerimeterClassification {
  if (p && typeof (p as PerimeterClassification).onPerimeter === "boolean")
    return p as PerimeterClassification;
  const pole = statements.find((s) => s.source === "FIELD_OBSERVED_POLE_ALIGNMENT");
  return classifyPerimeter({
    ...((p as PerimeterInput | null) ?? {}),
    poleReference:
      (p as PerimeterInput | null)?.poleReference ?? pole?.poleRefStart ?? pole?.value ?? null,
  });
}

/** THE resolver. Pure, deterministic, read-only. */
export function resolveEffectiveLocation(
  input: ResolveEffectiveLocationInput,
): EffectiveLocation {
  const perimeter = asClassification(input.perimeter ?? null, input.statements);
  const warnings: LocationWarning[] = [];

  const statements: ResolvedStatement[] = input.statements
    .map((s) => {
      const rank = EFFECTIVE_LOCATION_PRIORITY.indexOf(s.source);
      const raw =
        clean(s.value) ??
        (s.source === "APPROVED_DESIGN_XY"
          ? num(s.designXFt) != null && num(s.designYFt) != null
            ? `${s.designXFt} ft E / ${s.designYFt} ft S`
            : null
          : null) ??
        (s.source === "FIELD_OBSERVED_POLE_ALIGNMENT"
          ? [clean(s.poleRefStart), clean(s.poleRefEnd)].filter(Boolean).join("/") || null
          : null);
      const r =
        s.source === "FIELD_OBSERVED_POLE_ALIGNMENT"
          ? resolvePole(s)
          : s.source === "APPROVED_DESIGN_XY"
            ? resolveDesignXy(s)
            : s.source === "ORIGINAL_GRID"
              ? resolveOriginal(raw)
              : resolveGrid(raw);
      const accepted = s.accepted == null ? true : Boolean(s.accepted);
      const valid = r.label != null;
      let eligible = valid;
      let reason = r.reason;

      if (valid && OBSERVED.includes(s.source) && !accepted) {
        eligible = false;
        reason = "Observation is not accepted, so it cannot determine the effective location.";
      }
      if (s.source === "FIELD_OBSERVED_POLE_ALIGNMENT" && !perimeter.onPerimeter) {
        eligible = false;
        reason = `Pole alignment is ineligible: this object is not on the building perimeter. ${perimeter.basis}`;
      }
      return {
        source: s.source,
        id: clean(s.id),
        rank: rank < 0 ? EFFECTIVE_LOCATION_PRIORITY.length : rank,
        raw,
        label: r.label,
        xFt: r.xFt,
        yFt: r.yFt,
        spanned: r.spanned,
        valid,
        eligible,
        reason,
        evidence: clean(s.evidence),
        observedAt: clean(s.observedAt),
        confidence: clean(s.confidence),
        accepted,
        supersedes: (s.supersedes ?? []).filter(Boolean) as string[],
      } satisfies ResolvedStatement;
    })
    .sort((a, b) => a.rank - b.rank);

  for (const st of statements) {
    if (!st.valid && st.raw != null)
      warnings.push({
        code:
          st.source === "FIELD_OBSERVED_POLE_ALIGNMENT"
            ? "INCOMPLETE_POLE_REFERENCE"
            : "INVALID_SOURCE_VALUE",
        source: st.source,
        message: `${st.source}: ${st.reason ?? "value is not resolvable"} Falling through to the next valid source; the recorded value is preserved.`,
      });
    else if (st.valid && !st.eligible)
      warnings.push({
        code:
          st.source === "FIELD_OBSERVED_POLE_ALIGNMENT" && !perimeter.onPerimeter
            ? "POLE_ALIGNMENT_NOT_ELIGIBLE"
            : "OBSERVATION_NOT_ACCEPTED",
        source: st.source,
        message: `${st.source}: ${st.reason ?? "not eligible"}`,
      });
  }

  // Winning tier = highest-priority source with at least one eligible statement.
  const tierSource = EFFECTIVE_LOCATION_PRIORITY.find((src) =>
    statements.some((s) => s.source === src && s.eligible),
  );

  if (!tierSource) {
    warnings.push({
      code: "NO_RESOLVABLE_LOCATION",
      source: null,
      message: "No valid, eligible location source is recorded for this object.",
    });
    return {
      version: EFFECTIVE_LOCATION_VERSION,
      perimeter,
      effective: null,
      statements,
      warnings,
      conflict: null,
      requiresAdjudication: false,
      provenance: "Location not recorded · no eligible source · unresolved",
    };
  }

  const tier = statements.filter((s) => s.source === tierSource && s.eligible);
  const disagreeing = tier.filter((s) =>
    tier.some(
      (o) =>
        o !== s &&
        (o.label !== s.label ||
          Math.abs((o.xFt ?? 0) - (s.xFt ?? 0)) > TOLERANCE_FT ||
          Math.abs((o.yFt ?? 0) - (s.yFt ?? 0)) > TOLERANCE_FT),
    ),
  );

  let chosen = tier[0]!;
  let conflict: LocationConflict | null = null;

  if (disagreeing.length > 1) {
    // Only an explicit supersede relationship may resolve equal-priority disagreement.
    const superseded = new Set(
      disagreeing.flatMap((s) => s.supersedes).filter((id): id is string => Boolean(id)),
    );
    const survivors = disagreeing.filter((s) => !s.id || !superseded.has(s.id));
    if (survivors.length === 1) {
      chosen = survivors[0]!;
    } else {
      conflict = {
        source: tierSource,
        statements: disagreeing,
        message: `Location conflict: ${disagreeing.length} accepted ${tierSource} observations disagree (${disagreeing
          .map((s) => `${s.label}${s.observedAt ? ` observed ${s.observedAt}` : ""}${s.evidence ? ` [${s.evidence}]` : ""}`)
          .join(" vs ")}). Both statements are preserved; adjudication is required and no value was selected or overwritten.`,
      };
      warnings.push({
        code: "EQUAL_PRIORITY_CONFLICT",
        source: tierSource,
        message: conflict.message,
      });
      return {
        version: EFFECTIVE_LOCATION_VERSION,
        perimeter,
        effective: null,
        statements,
        warnings,
        conflict,
        requiresAdjudication: true,
        provenance: "Location conflict · adjudication required · both observations preserved",
      };
    }
  }

  const effective = {
    source: chosen.source,
    label: chosen.label!,
    xFt: chosen.xFt,
    yFt: chosen.yFt,
    spanned: chosen.spanned,
    evidence: chosen.evidence,
    observedAt: chosen.observedAt,
    confidence: chosen.confidence,
  };

  return {
    version: EFFECTIVE_LOCATION_VERSION,
    perimeter,
    effective,
    statements,
    warnings,
    conflict: null,
    requiresAdjudication: false,
    provenance: formatLocationProvenance({
      source: chosen.source,
      label: chosen.label!,
      spanned: chosen.spanned,
      confidence: chosen.confidence,
    }),
  };
}

/** "A8 · observed A1–F9 grid · field verified" */
export function formatLocationProvenance(e: {
  source: EffectiveLocationSource;
  label: string;
  spanned?: boolean;
  confidence?: string | null;
}): string {
  const evidence = e.spanned
    ? `${EFFECTIVE_LOCATION_EVIDENCE_WORD[e.source]} (span, not a point)`
    : EFFECTIVE_LOCATION_EVIDENCE_WORD[e.source];
  const conf = e.confidence ? ` (${e.confidence})` : "";
  return `${e.label} · ${EFFECTIVE_LOCATION_SOURCE_PHRASE[e.source]} · ${evidence}${conf}`;
}

/* ------------------------------------------------------------- record adapter */

/**
 * Shape any electrical record can be mapped onto. The adapter is deliberately
 * dumb: it moves recorded values into statements and never interprets text.
 */
export interface EffectiveLocationRecord {
  stableId?: string | null;
  /** Applied field-observed perimeter pole alignment. */
  poleScheme?: string | null;
  poleLocationKind?: PoleLocationKindLike | null;
  poleRefStart?: string | null;
  poleRefEnd?: string | null;
  poleEvidence?: string | null;
  poleObservedAt?: string | null;
  /** Applied field-observed current-grid cell. */
  fieldGridReference?: string | null;
  fieldGridEvidence?: string | null;
  fieldGridObservedAt?: string | null;
  /**
   * Approved design coordinates for a planned, pattern-generated object. Exact
   * feet; the derived grid label is never treated as field evidence.
   */
  designXFt?: number | null;
  designYFt?: number | null;
  designApprovalReference?: string | null;
  /** Accepted legacy→current remap result. */
  remappedGridReference?: string | null;
  remappedEvidence?: string | null;
  /** Original (legacy) grid assignment. */
  originalGrid?: string | null;
  /** Explicit perimeter inputs — never a description. */
  topologyPlacement?: string | null;
  wallClassification?: string | null;
  fieldEvidencePerimeter?: boolean | null;
  /** Extra accepted observations (used when a record carries more than one). */
  extraStatements?: LocationStatement[];
}

export function effectiveLocationForRecord(
  record: EffectiveLocationRecord,
): EffectiveLocation {
  const statements: LocationStatement[] = [];
  const kind = (record.poleLocationKind ?? "").toString().trim().toUpperCase();
  if (kind && kind !== "NOT_APPLICABLE") {
    statements.push({
      source: "FIELD_OBSERVED_POLE_ALIGNMENT",
      id: "record-pole",
      poleScheme: record.poleScheme ?? null,
      poleLocationKind: kind,
      poleRefStart: record.poleRefStart ?? null,
      poleRefEnd: record.poleRefEnd ?? null,
      evidence: record.poleEvidence ?? null,
      observedAt: record.poleObservedAt ?? null,
    });
  }
  if (clean(record.fieldGridReference))
    statements.push({
      source: "FIELD_OBSERVED_GRID",
      id: "record-field-grid",
      value: record.fieldGridReference ?? null,
      evidence: record.fieldGridEvidence ?? null,
      observedAt: record.fieldGridObservedAt ?? null,
    });
  if (
    typeof record.designXFt === "number" ||
    typeof record.designYFt === "number"
  )
    statements.push({
      source: "APPROVED_DESIGN_XY",
      id: "record-approved-design-xy",
      designXFt: record.designXFt ?? null,
      designYFt: record.designYFt ?? null,
      evidence: record.designApprovalReference ?? null,
    });
  if (clean(record.remappedGridReference))
    statements.push({
      source: "GRID_REMAPPED",
      id: "record-remapped-grid",
      value: record.remappedGridReference ?? null,
      evidence: record.remappedEvidence ?? null,
    });
  if (clean(record.originalGrid))
    statements.push({
      source: "ORIGINAL_GRID",
      id: "record-original-grid",
      value: record.originalGrid ?? null,
    });
  statements.push(...(record.extraStatements ?? []));

  return resolveEffectiveLocation({
    stableId: record.stableId ?? null,
    perimeter: {
      topologyPlacement: record.topologyPlacement ?? null,
      wallClassification: record.wallClassification ?? null,
      fieldEvidencePerimeter: record.fieldEvidencePerimeter ?? null,
      poleReference: record.poleRefStart ?? null,
    },
    statements,
  });
}

/**
 * Recomputation for an approved audit transaction: given the record as it stands
 * and the observation the batch is accepting, return the effective location
 * before and after. The derived value changes in the same approved transaction —
 * no separate metadata reconciliation step — and no prior evidence is removed.
 */
export function effectiveLocationAfterObservation(
  record: EffectiveLocationRecord,
  observation: {
    fieldGridReference?: string | null;
    poleScheme?: string | null;
    poleLocationKind?: PoleLocationKindLike | null;
    poleRefStart?: string | null;
    poleRefEnd?: string | null;
    evidence?: string | null;
    observedAt?: string | null;
    /** Explicit perimeter statement carried by the observation, if any. */
    fieldEvidencePerimeter?: boolean | null;
  },
): { before: EffectiveLocation; after: EffectiveLocation; changed: boolean } {
  const before = effectiveLocationForRecord(record);
  const merged: EffectiveLocationRecord = {
    ...record,
    // Prior values are preserved: the observation only supplies higher-priority
    // statements, it never clears the remapped or original assignment.
    fieldGridReference: clean(observation.fieldGridReference) ?? record.fieldGridReference ?? null,
    fieldGridEvidence: clean(observation.fieldGridReference)
      ? (observation.evidence ?? record.fieldGridEvidence ?? null)
      : (record.fieldGridEvidence ?? null),
    fieldGridObservedAt: clean(observation.fieldGridReference)
      ? (observation.observedAt ?? record.fieldGridObservedAt ?? null)
      : (record.fieldGridObservedAt ?? null),
    poleScheme: observation.poleScheme ?? record.poleScheme ?? null,
    poleLocationKind: observation.poleLocationKind ?? record.poleLocationKind ?? null,
    poleRefStart: observation.poleRefStart ?? record.poleRefStart ?? null,
    poleRefEnd: observation.poleRefEnd ?? record.poleRefEnd ?? null,
    poleEvidence: observation.poleLocationKind
      ? (observation.evidence ?? record.poleEvidence ?? null)
      : (record.poleEvidence ?? null),
    poleObservedAt: observation.poleLocationKind
      ? (observation.observedAt ?? record.poleObservedAt ?? null)
      : (record.poleObservedAt ?? null),
    fieldEvidencePerimeter:
      observation.fieldEvidencePerimeter ?? record.fieldEvidencePerimeter ?? null,
  };
  const after = effectiveLocationForRecord(merged);
  return {
    before,
    after,
    changed:
      before.provenance !== after.provenance ||
      before.effective?.source !== after.effective?.source,
  };
}
