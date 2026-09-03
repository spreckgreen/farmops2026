import { describe, expect, it } from "vitest";
import {
  BUNDLE_ENVELOPE_FORMAT,
  buildVersionedBundleFile,
  parseVersionedBundleFile,
  verifyVersionedBundleFile,
  versionedBundleFileName,
} from "@/lib/electrical-bundle-version";
import type { DocumentBundle } from "@/lib/electrical-documents";

const bundle: DocumentBundle = {
  schema_version: "1.2",
  generated_at: "2026-09-01T12:00:00Z",
  manifest: [{ collection: "loads", count: 1, purpose: "p", intended_use: "u" }],
  qa: { errors: 0, warnings: 2, findings: [] },
  counts: { loads: 1 },
  snapshot: {
    schema_version: "1.2",
    generated_at: "2026-09-01T12:00:00Z",
    loads: [{ stable_id: "FS-001", panel: "PNL-FS-NW" }],
  },
};

describe("versioned document bundle", () => {
  it("captures the snapshot version and verifies its digest round-trip", async () => {
    const file = await buildVersionedBundleFile(bundle, {
      apiVersion: "v1",
      capturedBy: "owner@example.com",
      capturedAt: "2026-09-03T14:00:00Z",
    });
    expect(file.envelope_format).toBe(BUNDLE_ENVELOPE_FORMAT);
    expect(file.schema_version).toBe("1.2");
    expect(file.generated_at).toBe("2026-09-01T12:00:00Z");
    expect(file.bundle_version_code.startsWith("FS-BUNDLE-1.2-")).toBe(true);
    expect(versionedBundleFileName(file)).toContain("2026-09-01");

    const parsed = parseVersionedBundleFile(JSON.stringify(file));
    expect(parsed.bundle_version_code).toBe(file.bundle_version_code);
    expect((await verifyVersionedBundleFile(parsed)).status).toBe("verified");
  });

  it("reports an altered capture instead of trusting it", async () => {
    const file = await buildVersionedBundleFile(bundle, {
      apiVersion: "v1",
      capturedBy: "owner@example.com",
    });
    const tampered = parseVersionedBundleFile(
      JSON.stringify({ ...file, bundle: { ...bundle, counts: { loads: 99 } } }),
    );
    expect((await verifyVersionedBundleFile(tampered)).status).toBe("digest-mismatch");
  });

  it("rejects files that are not this envelope", () => {
    expect(() => parseVersionedBundleFile("not json")).toThrow(/valid JSON/);
    expect(() => parseVersionedBundleFile(JSON.stringify({ bundle }))).toThrow(/Unsupported envelope/);
    expect(() =>
      parseVersionedBundleFile(JSON.stringify({ envelope_format: BUNDLE_ENVELOPE_FORMAT })),
    ).toThrow(/no snapshot bundle/);
  });
});
