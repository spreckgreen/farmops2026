import { describe, expect, it } from "vitest";
import {
  GRANT_WINDOW_HOURS,
  accessState,
  grantExpiry,
  isEditUnlocked,
  latestRequest,
  panelLabelLines,
  panelQrUrl,
  parsePanelQr,
  remainingLabel,
  type PanelEditRequest,
} from "@/lib/electrical-panel-access";

const base: PanelEditRequest = {
  id: "r1",
  panel_id: "PNL-H1",
  requester_id: "u1",
  requester_email: "sparky@example.com",
  reason: "breaker 29 mislabelled",
  scope: "panel_edit",
  scope_detail: null,
  status: "pending",

  decided_by: null,
  decided_at: null,
  decision_note: null,
  expires_at: null,
  revoked_at: null,
  created_at: "2026-01-01T10:00:00.000Z",
};

describe("grant window", () => {
  it("expires exactly 24 hours after approval", () => {
    expect(grantExpiry("2026-01-01T10:00:00.000Z")).toBe("2026-01-02T10:00:00.000Z");
    expect(GRANT_WINDOW_HOURS).toBe(24);
  });

  it("rejects an unparseable approval timestamp instead of inventing one", () => {
    expect(() => grantExpiry("not a date")).toThrow(/invalid approval timestamp/i);
  });
});

describe("accessState", () => {
  const now = new Date("2026-01-01T12:00:00.000Z");

  it("reports read-only when nothing was ever requested", () => {
    expect(accessState(null, now)).toBe("none");
    expect(isEditUnlocked(null, now)).toBe(false);
  });

  it("stays pending until an administrator decides", () => {
    expect(accessState(base, now)).toBe("pending");
    expect(isEditUnlocked(base, now)).toBe(false);
  });

  it("unlocks editing only inside the approved window", () => {
    const approved: PanelEditRequest = {
      ...base,
      status: "approved",
      decided_at: "2026-01-01T11:00:00.000Z",
      expires_at: "2026-01-02T11:00:00.000Z",
    };
    expect(accessState(approved, now)).toBe("active");
    expect(isEditUnlocked(approved, now)).toBe(true);
    expect(accessState(approved, new Date("2026-01-03T00:00:00.000Z"))).toBe("expired");
    expect(isEditUnlocked(approved, new Date("2026-01-03T00:00:00.000Z"))).toBe(false);
  });

  it("treats revocation as an immediate close, even before expiry", () => {
    const revoked: PanelEditRequest = {
      ...base,
      status: "approved",
      expires_at: "2026-01-02T11:00:00.000Z",
      revoked_at: "2026-01-01T11:30:00.000Z",
    };
    expect(accessState(revoked, now)).toBe("revoked");
    expect(isEditUnlocked(revoked, now)).toBe(false);
  });

  it("never unlocks a declined request", () => {
    const rejected: PanelEditRequest = { ...base, status: "rejected", decided_at: "x" };
    expect(accessState(rejected, now)).toBe("rejected");
    expect(isEditUnlocked(rejected, now)).toBe(false);
  });

  it("treats an approved row with no expiry as expired rather than open-ended", () => {
    expect(accessState({ ...base, status: "approved" }, now)).toBe("expired");
  });
});

describe("latestRequest", () => {
  it("uses the newest row so an old decision cannot mask a new ask", () => {
    const older = { ...base, id: "old", created_at: "2025-12-01T10:00:00.000Z" };
    const newer = { ...base, id: "new", created_at: "2026-01-05T10:00:00.000Z" };
    expect(latestRequest([older, newer])?.id).toBe("new");
    expect(latestRequest([])).toBeNull();
  });
});

describe("remainingLabel", () => {
  const now = new Date("2026-01-01T12:00:00.000Z");
  it("reads as field-usable remaining time", () => {
    expect(remainingLabel("2026-01-02T11:41:00.000Z", now)).toBe("23h 41m left");
    expect(remainingLabel("2026-01-01T12:20:00.000Z", now)).toBe("20m left");
    expect(remainingLabel("2026-01-01T11:00:00.000Z", now)).toBe("expired");
    expect(remainingLabel(null, now)).toBe("no window");
  });
});

describe("QR payload", () => {
  it("encodes a stable, typable panel URL", () => {
    expect(panelQrUrl("https://bostead.lovable.app/", "PNL-H1")).toBe(
      "https://bostead.lovable.app/electrical/panel/PNL-H1",
    );
  });

  it("reads back a scanned label URL, path or bare ID", () => {
    expect(parsePanelQr("https://bostead.lovable.app/electrical/panel/PNL-H1")).toBe("PNL-H1");
    expect(parsePanelQr("/electrical/panel/pnl-fs-crit")).toBe("PNL-FS-CRIT");
    expect(parsePanelQr(" pnl-ph ")).toBe("PNL-PH");
  });

  it("refuses codes that are not panel labels instead of guessing an ID", () => {
    expect(parsePanelQr("https://example.com/some/other/page")).toBeNull();
    expect(parsePanelQr("WIFI:S=farm;T=WPA;P=secret;;")).toBeNull();
    expect(parsePanelQr("")).toBeNull();
    expect(parsePanelQr("   ")).toBeNull();
  });
});

describe("panelLabelLines", () => {
  it("prints only populated fields and prefers a full voltage designation", () => {
    const lines = panelLabelLines(
      {
        panel_id: "PNL-H1",
        description: "House main panel",
        building: "House",
        grid: "C4",
        bus_rating_amps: 200,
        voltage: 240,
        phase: "1",
        spaces: 40,
        feeder_source: null,
      },
      "120/240 V, 1φ, 3-wire",
    );
    const map = Object.fromEntries(lines.map((l) => [l.label, l.value]));
    expect(map["Location"]).toBe("House · C4");
    expect(map["Main / bus"]).toBe("200 A");
    expect(map["Voltage"]).toBe("120/240 V, 1φ, 3-wire");
    expect(map).not.toHaveProperty("Fed from");
  });

  it("falls back to the scalar voltage when no designation is stored", () => {
    const lines = panelLabelLines({ panel_id: "PNL-BLR", voltage: 240, phase: "1" }, null);
    expect(lines.find((l) => l.label === "Voltage")?.value).toBe("240 · 1");
  });
});
