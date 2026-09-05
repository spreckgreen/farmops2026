import { describe, expect, it } from "vitest";
import {
  STATUS_FRESH_MINUTES,
  cameraLiveState,
  checkAgeMinutes,
  isCheckable,
  needsRecheck,
  statusToken,
  type CameraRow,
} from "@/lib/cameras";

const NOW = new Date("2026-09-05T15:00:00Z");
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60000).toISOString();

type StateRow = Pick<CameraRow, "status" | "last_check_at" | "stream_url" | "snapshot_url">;
const row = (over: Partial<StateRow> = {}): StateRow => ({
  status: "unknown",
  last_check_at: null,
  stream_url: null,
  snapshot_url: null,
  ...over,
});

describe("what can be checked at all", () => {
  it("needs a feed or snapshot address", () => {
    expect(isCheckable(row())).toBe(false);
    expect(isCheckable(row({ stream_url: "https://x/y.m3u8" }))).toBe(true);
    expect(isCheckable(row({ snapshot_url: "https://x/s.jpg" }))).toBe(true);
    expect(isCheckable(row({ stream_url: "   " }))).toBe(false);
  });
});

describe("age of the last check", () => {
  it("is null when never checked", () => {
    expect(checkAgeMinutes(row(), NOW)).toBeNull();
    expect(checkAgeMinutes(row({ last_check_at: "not a date" }), NOW)).toBeNull();
  });

  it("counts whole minutes and never goes negative", () => {
    expect(checkAgeMinutes(row({ last_check_at: minsAgo(7) }), NOW)).toBe(7);
    expect(checkAgeMinutes(row({ last_check_at: minsAgo(-5) }), NOW)).toBe(0);
  });
});

describe("live state never guesses", () => {
  it("says never checked when there is an address but no check", () => {
    const state = cameraLiveState(row({ stream_url: "https://x/y.m3u8" }), NOW);
    expect(state).toMatchObject({ status: "unknown", freshness: "never", label: "Never checked" });
  });

  it("says there is nothing to check when no address is recorded", () => {
    const state = cameraLiveState(row(), NOW);
    expect(state.checkable).toBe(false);
    expect(state.label).toBe("No address to check");
  });

  it("reports a recent successful check as fresh", () => {
    const state = cameraLiveState(
      row({ status: "online", last_check_at: minsAgo(2), snapshot_url: "https://x/s.jpg" }),
      NOW,
    );
    expect(state.freshness).toBe("fresh");
    expect(state.label).toBe("Online — checked 2 min ago");
  });

  it("marks an old check as ageing rather than presenting it as live", () => {
    const state = cameraLiveState(
      row({
        status: "online",
        last_check_at: minsAgo(STATUS_FRESH_MINUTES + 1),
        snapshot_url: "https://x/s.jpg",
      }),
      NOW,
    );
    expect(state.freshness).toBe("ageing");
    expect(state.label).toContain("needs a fresh check");
  });

  it("keeps an offline result offline, it is never softened to unknown", () => {
    const state = cameraLiveState(
      row({ status: "offline", last_check_at: minsAgo(1), stream_url: "https://x/y.m3u8" }),
      NOW,
    );
    expect(state.status).toBe("offline");
    expect(state.label).toBe("Offline — checked 1 min ago");
  });

  it("treats the boundary minute as still fresh", () => {
    expect(
      cameraLiveState(
        row({
          status: "online",
          last_check_at: minsAgo(STATUS_FRESH_MINUTES),
          stream_url: "https://x/y.m3u8",
        }),
        NOW,
      ).freshness,
    ).toBe("fresh");
  });
});

describe("which cameras are worth re-checking", () => {
  it("counts only checkable cameras whose state has aged", () => {
    const rows = [
      row({ status: "online", last_check_at: minsAgo(1), stream_url: "https://a" }),
      row({ status: "offline", last_check_at: minsAgo(90), stream_url: "https://b" }),
      row({ stream_url: "https://c" }),
      row(),
    ];
    expect(needsRecheck(rows, NOW)).toBe(2);
  });
});

describe("status colours come from design tokens", () => {
  it("uses distinct tokens per state and no raw colours", () => {
    const tokens = [statusToken("online"), statusToken("offline"), statusToken("unknown")];
    expect(new Set(tokens).size).toBe(3);
    for (const token of tokens) expect(token.startsWith("var(--")).toBe(true);
  });
});
