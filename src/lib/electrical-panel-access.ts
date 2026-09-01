// Panel QR labels + temporary edit-access grants.
//
// Pure module: URL/label formatting and grant-window arithmetic only. No I/O,
// no writes. The server functions in `panel-access.functions.ts` own the data
// and re-check every rule; nothing here is a security boundary.

/** A granted edit window is always 24 hours from the administrator's approval. */
export const GRANT_WINDOW_HOURS = 24;

export const PANEL_ACCESS_MODEL_VERSION = "panel-qr-access-1";

export type PanelAccessStatus = "pending" | "approved" | "rejected";

export interface PanelEditRequest {
  id: string;
  panel_id: string;
  requester_id: string;
  requester_email: string | null;
  reason: string | null;
  status: PanelAccessStatus;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

/**
 * What a requester may do right now.
 * - `none`      — never asked (or the last ask is closed and stale)
 * - `pending`   — waiting on an administrator
 * - `active`    — approved and inside the 24-hour window: editing is unlocked
 * - `expired`   — approved but the window closed; a new request is required
 * - `revoked`   — an administrator ended the window early
 * - `rejected`  — the administrator declined
 */
export type PanelAccessState = "none" | "pending" | "active" | "expired" | "revoked" | "rejected";

/** Expiry for a window approved at `approvedAtIso`. */
export function grantExpiry(approvedAtIso: string, hours = GRANT_WINDOW_HOURS): string {
  const t = Date.parse(approvedAtIso);
  if (!Number.isFinite(t)) throw new Error("grantExpiry: invalid approval timestamp");
  return new Date(t + hours * 3600_000).toISOString();
}

export function accessState(
  request: PanelEditRequest | null | undefined,
  now: Date = new Date(),
): PanelAccessState {
  if (!request) return "none";
  if (request.status === "pending") return "pending";
  if (request.status === "rejected") return "rejected";
  if (request.revoked_at) return "revoked";
  const exp = request.expires_at ? Date.parse(request.expires_at) : NaN;
  if (!Number.isFinite(exp)) return "expired";
  return exp > now.getTime() ? "active" : "expired";
}

export function isEditUnlocked(
  request: PanelEditRequest | null | undefined,
  now: Date = new Date(),
): boolean {
  return accessState(request, now) === "active";
}

/** The newest request for a panel wins; older rows stay as history. */
export function latestRequest(rows: PanelEditRequest[]): PanelEditRequest | null {
  let best: PanelEditRequest | null = null;
  for (const r of rows) {
    if (!best || Date.parse(r.created_at) > Date.parse(best.created_at)) best = r;
  }
  return best;
}

/** "23h 41m left" / "expired" — plain field-readable remaining time. */
export function remainingLabel(expiresAt: string | null, now: Date = new Date()): string {
  const exp = expiresAt ? Date.parse(expiresAt) : NaN;
  if (!Number.isFinite(exp)) return "no window";
  const ms = exp - now.getTime();
  if (ms <= 0) return "expired";
  const mins = Math.floor(ms / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}

/* --------------------------------------------------------------- QR payload */

/**
 * The URL a printed panel label encodes. Stable and human-typable, so a smudged
 * label can still be entered by hand: /electrical/panel/PNL-H1
 */
export function panelQrUrl(origin: string, panelId: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/electrical/panel/${encodeURIComponent(panelId.trim())}`;
}

const PANEL_ID_RE = /^[A-Z0-9][A-Z0-9._/-]{1,60}$/;

/**
 * Read a scanned code back into a panel ID. Accepts a full label URL, a bare
 * path or a bare stable ID, and never invents an ID it did not see.
 */
export function parsePanelQr(scanned: string): string | null {
  const text = (scanned ?? "").trim();
  if (!text) return null;
  let candidate = text;
  const match = text.match(/\/electrical\/panel\/([^/?#\s]+)/i);
  if (match) {
    candidate = decodeURIComponent(match[1]!);
  } else if (/^https?:\/\//i.test(text) || text.includes("/")) {
    // A URL or path that is not a panel label — do not guess.
    return null;
  }
  candidate = candidate.trim().toUpperCase();
  return PANEL_ID_RE.test(candidate) ? candidate : null;
}

/* ------------------------------------------------------------ label content */

export interface PanelLabelSource {
  panel_id: string;
  description?: string | null;
  building?: string | null;
  grid?: string | null;
  bus_rating_amps?: number | string | null;
  voltage?: number | string | null;
  phase?: string | null;
  spaces?: number | string | null;
  feeder_source?: string | null;
  system_voltage?: unknown;
}

export interface LabelLine {
  label: string;
  value: string;
}

/**
 * The lines printed under the QR code. Only what an electrician reads at the
 * panel door: where it is, what feeds it, what it is rated for.
 */
export function panelLabelLines(panel: PanelLabelSource, voltageText?: string | null): LabelLine[] {
  const val = (v: unknown) => {
    const s = String(v ?? "").trim();
    return s.length ? s : "";
  };
  const lines: LabelLine[] = [
    { label: "Location", value: [val(panel.building), val(panel.grid)].filter(Boolean).join(" · ") },
    { label: "Description", value: val(panel.description) },
    { label: "Fed from", value: val(panel.feeder_source) },
    {
      label: "Main / bus",
      value: val(panel.bus_rating_amps) ? `${val(panel.bus_rating_amps)} A` : "",
    },
    {
      label: "Voltage",
      value: val(voltageText) || [val(panel.voltage), val(panel.phase)].filter(Boolean).join(" · "),
    },
    { label: "Spaces", value: val(panel.spaces) },
  ];
  return lines.filter((l) => l.value.length > 0);
}
