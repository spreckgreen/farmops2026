/**
 * One farm, one calendar. Every "what day is it" decision in the app resolves
 * in the FARM's timezone, not UTC and not the visitor's browser zone.
 *
 * Why this exists: the UI computed "today" from the browser's local clock while
 * server functions computed it with `{ timeZone: "UTC" }`. At 23:00 Friday in
 * New York it is already 03:00 Saturday in UTC, so an evening commit wrote to
 * Saturday's note and stamped `closed_at` on Saturday — and the work reappeared
 * on Saturday's board the next morning.
 *
 * Example (America/New_York):
 *   appDateString(new Date("2026-08-22T03:15:00Z")) // => "2026-08-21"
 *   dayBoundsUtc("2026-08-21")
 *     // => { start: "2026-08-21T04:00:00.000Z", end: "2026-08-22T03:59:59.999Z" }
 */

/** Override with `VITE_APP_TIME_ZONE=America/Denver` (client) or `APP_TIME_ZONE` (server). */
export const APP_TIME_ZONE: string =
  (typeof process !== "undefined" ? process.env?.["APP_TIME_ZONE"] : undefined) ||
  (typeof import.meta !== "undefined"
    ? (import.meta as { env?: Record<string, string | undefined> }).env?.[
        "VITE_APP_TIME_ZONE"
      ]
    : undefined) ||
  "America/New_York";

function zonedParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  // Intl can render midnight as hour 24 in some engines.
  const hour = get("hour") % 24;
  return { y: get("year"), m: get("month"), d: get("day"), hour, min: get("minute"), s: get("second") };
}

/** Offset of `timeZone` from UTC, in minutes, at instant `at` (EDT => -240). */
function offsetMinutes(at: Date, timeZone: string): number {
  const p = zonedParts(at, timeZone);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hour, p.min, p.s);
  return (asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000;
}

/** `YYYY-MM-DD` for the farm's calendar day containing `now`. */
export function appDateString(now: Date = new Date(), timeZone: string = APP_TIME_ZONE): string {
  const p = zonedParts(now, timeZone);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** UTC instant of local midnight starting `date` (`YYYY-MM-DD`) in the farm zone. */
export function dayStartUtc(date: string, timeZone: string = APP_TIME_ZONE): Date {
  const [y, m, d] = date.split("-").map(Number);
  const naive = Date.UTC(y!, (m ?? 1) - 1, d ?? 1, 0, 0, 0);
  // Two passes settle DST transitions (the offset depends on the instant).
  let t = naive - offsetMinutes(new Date(naive), timeZone) * 60000;
  t = naive - offsetMinutes(new Date(t), timeZone) * 60000;
  return new Date(t);
}

/** Inclusive UTC ISO bounds of the farm-local day `date`. */
export function dayBoundsUtc(
  date: string,
  timeZone: string = APP_TIME_ZONE,
): { start: string; end: string } {
  const start = dayStartUtc(date, timeZone);
  const nextDay = appDateStringAfter(date);
  const end = new Date(dayStartUtc(nextDay, timeZone).getTime() - 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Calendar day after `date` (`"2026-08-21"` => `"2026-08-22"`). */
export function appDateStringAfter(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y!, (m ?? 1) - 1, (d ?? 1) + 1));
  return next.toISOString().slice(0, 10);
}

/** Calendar day before `date` (`"2026-08-22"` => `"2026-08-21"`). */
export function appDateStringBefore(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const prev = new Date(Date.UTC(y!, (m ?? 1) - 1, (d ?? 1) - 1));
  return prev.toISOString().slice(0, 10);
}

/**
 * Move `stamp` onto calendar day `day`, preserving its local wall-clock time.
 * `shiftStampToDay("2026-08-22", "2026-08-21T23:10:00.000Z")` keeps 19:10 local
 * but on Aug 22.
 */
export function shiftStampToDay(day: string, stamp: string): string {
  const from = appDateString(new Date(stamp));
  const delta = dayStartUtc(day).getTime() - dayStartUtc(from).getTime();
  const shifted = new Date(new Date(stamp).getTime() + delta);
  if (appDateString(shifted) === day) return shifted.toISOString();
  return new Date(dayStartUtc(day).getTime() + 12 * 3600 * 1000).toISOString();
}
