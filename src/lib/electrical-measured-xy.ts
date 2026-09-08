/**
 * Measured field X/Y coordinate records.
 *
 * A measured X/Y is an actual instrument measurement taken on site (tape, laser,
 * GPS, total station). It is the highest-authority location statement FarmOps
 * recognises: it outranks a verified post, a verified interval, a verified grid
 * cell and every accepted design coordinate, and it is the only source that may
 * be presented as a measured coordinate. Derived centroids, post anchors and
 * interval midpoints are never labelled measured.
 *
 * Kept in its own module so both the audit manifest layer and the location
 * precedence layer can share the vocabulary without an import cycle.
 */

export const MEASURED_XY_METHODS = [
  "TAPE",
  "LASER",
  "GPS_RTK",
  "GPS_HANDHELD",
  "TOTAL_STATION",
  "OTHER",
] as const;

export type MeasuredXyMethod = (typeof MEASURED_XY_METHODS)[number];

export const MEASURED_XY_METHOD_LABEL: Record<MeasuredXyMethod, string> = {
  TAPE: "Tape measure",
  LASER: "Laser rangefinder",
  GPS_RTK: "RTK GPS",
  GPS_HANDHELD: "Handheld GPS",
  TOTAL_STATION: "Total station",
  OTHER: "Other measured method",
};

/** The stated method, normalised; null when the record states no measurement. */
export function measuredXyMethodOf(v: string | null | undefined): MeasuredXyMethod | null {
  const t = (v ?? "").trim().toUpperCase();
  return (MEASURED_XY_METHODS as readonly string[]).includes(t) ? (t as MeasuredXyMethod) : null;
}

/** Database columns that carry a measured field X/Y record. */
export const MEASURED_XY_COLUMNS = [
  "measured_xy_method",
  "measured_xy_accuracy_ft",
  "measured_xy_datum",
  "measured_xy_at",
  "measured_xy_by",
] as const;
