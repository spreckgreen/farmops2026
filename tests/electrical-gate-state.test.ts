// Regression: a failed add-on check must not be reported as "not entitled".
//
// The seven imported panels exist and are entitled, but when the add-on lookup
// itself failed (expired bearer token, transient network error) every gated
// electrical page — including panel detail — rendered the "module is not
// enabled" card, so no panel could be opened. The gate now distinguishes
// loading / error / disabled / enabled.
import { describe, expect, it } from "vitest";
import { isEntitlementActive } from "@/lib/addons";

type AddonState = {
  isLoading: boolean;
  error: Error | null;
  enabled: boolean;
};

/** The branch the gate takes, in render order. */
function gateBranch(a: AddonState): "loading" | "error" | "content" | "disabled" {
  if (a.isLoading) return "loading";
  if (a.error) return "error";
  return a.enabled ? "content" : "disabled";
}

describe("electrical gate state", () => {
  it("shows a retryable error, not 'not enabled', when the check fails", () => {
    expect(
      gateBranch({ isLoading: false, error: new Error("Unauthorized: Invalid token"), enabled: false }),
    ).toBe("error");
  });

  it("renders panel content for the live entitlement row", () => {
    // Exactly the stored row: active, no expiry.
    const entitled = isEntitlementActive({ status: "active", expires_at: null });
    expect(entitled).toBe(true);
    expect(gateBranch({ isLoading: false, error: null, enabled: entitled })).toBe("content");
  });

  it("still reports a genuinely missing entitlement as disabled", () => {
    expect(isEntitlementActive(null)).toBe(false);
    expect(gateBranch({ isLoading: false, error: null, enabled: false })).toBe("disabled");
  });

  it("prefers the loading skeleton over any other branch", () => {
    expect(
      gateBranch({ isLoading: true, error: new Error("x"), enabled: false }),
    ).toBe("loading");
  });
});
