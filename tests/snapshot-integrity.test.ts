import { describe, it, expect } from "vitest";
import {
  computeIntegrity,
  normalizeIntegrityEnvelope,
  verifyIntegrity,
  canonicalStringify,
  sha256Hex,
  INTEGRITY_ALGO,
  type IntegrityEnvelope,
} from "@/lib/snapshot-integrity";
import { parseRestoreSnapshotJson } from "@/lib/snapshot-restore";
import { scopeRestoreRowsToUser } from "@/lib/admin.functions";

// Representative snapshot payload mimicking what the export route
// embeds (table rows + metadata). Keep small and deterministic.
const payload = {
  tables: [
    { name: "tasks", rows: [{ id: "t1", title: "Buy milk", done: false }] },
    { name: "projects", rows: [{ id: "p1", name: "Home" }] },
  ],
  exportedAt: "2026-06-24T16:00:00.000Z",
  userId: "00000000-0000-0000-0000-000000000001",
};

describe("canonicalStringify", () => {
  it("sorts keys alphabetically at every depth", () => {
    const a = canonicalStringify({ b: 1, a: { d: 2, c: 3 } });
    const b = canonicalStringify({ a: { c: 3, d: 2 }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
  it("preserves array order", () => {
    expect(canonicalStringify([3, 1, 2])).toBe("[3,1,2]");
  });
  it("drops undefined values", () => {
    expect(canonicalStringify({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe("computeIntegrity / verifyIntegrity — current envelope", () => {
  it("round-trips a freshly computed envelope", async () => {
    const env = await computeIntegrity(payload);
    expect(env.algo).toBe(INTEGRITY_ALGO);
    expect(env.value).toMatch(/^[0-9a-f]{64}$/);
    expect(env.covered).toEqual(Object.keys(payload).sort());
    const res = await verifyIntegrity(payload, env);
    expect(res.ok).toBe(true);
  });

  it("detects tampered payload rows", async () => {
    const env = await computeIntegrity(payload);
    const tampered = {
      ...payload,
      tables: [
        { name: "tasks", rows: [{ id: "t1", title: "Buy beer", done: false }] },
        { name: "projects", rows: [{ id: "p1", name: "Home" }] },
      ],
    };
    const res = await verifyIntegrity(tampered, env);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toMatch(/Checksum mismatch/);
      expect(res.expected).toBe(env.value);
      expect(res.actual).not.toBe(env.value);
    }
  });

  it("succeeds when only an uncovered field changes", async () => {
    const env = await computeIntegrity({
      tables: payload.tables,
      exportedAt: payload.exportedAt,
    });
    // userId is not in `covered`; mutating it must not invalidate.
    const res = await verifyIntegrity(
      { ...payload, userId: "mutated" },
      env,
    );
    expect(res.ok).toBe(true);
  });
});

describe("verifyIntegrity — legacy envelope (digest alias, no algo/covered)", () => {
  it("accepts a legacy envelope that only carries a `digest` field", async () => {
    const covered = Object.keys(payload).sort();
    const subset: Record<string, unknown> = {};
    for (const k of covered) subset[k] = (payload as Record<string, unknown>)[k];
    const digest = await sha256Hex(canonicalStringify(subset));
    // Legacy shape: { digest } only — no algo, no covered.
    const legacy = { digest } as unknown as IntegrityEnvelope;
    const res = await verifyIntegrity(payload, legacy);
    expect(res.ok).toBe(true);
  });

  it("still flags tampering on legacy envelopes", async () => {
    const covered = Object.keys(payload).sort();
    const subset: Record<string, unknown> = {};
    for (const k of covered) subset[k] = (payload as Record<string, unknown>)[k];
    const digest = await sha256Hex(canonicalStringify(subset));
    const legacy = { digest } as unknown as IntegrityEnvelope;
    const res = await verifyIntegrity(
      { ...payload, exportedAt: "1999-01-01T00:00:00.000Z" },
      legacy,
    );
    expect(res.ok).toBe(false);
  });
});

describe("verifyIntegrity — partial / missing field envelopes", () => {
  it("defaults algo to sha-256 when missing", async () => {
    const env = await computeIntegrity(payload);
    const partial = { value: env.value, covered: env.covered } as unknown as IntegrityEnvelope;
    const res = await verifyIntegrity(payload, partial);
    expect(res.ok).toBe(true);
  });

  it("defaults `covered` to all payload keys when missing", async () => {
    // Compute envelope manually using sorted keys (matches the default).
    const covered = Object.keys(payload).sort();
    const subset: Record<string, unknown> = {};
    for (const k of covered) subset[k] = (payload as Record<string, unknown>)[k];
    const value = await sha256Hex(canonicalStringify(subset));
    const partial = { algo: INTEGRITY_ALGO, value } as unknown as IntegrityEnvelope;
    const res = await verifyIntegrity(payload, partial);
    expect(res.ok).toBe(true);
  });

  it("rejects an envelope with no checksum value at all", async () => {
    const res = await verifyIntegrity(payload, {} as IntegrityEnvelope);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/missing the checksum/i);
  });

  it("rejects an envelope with an unsupported algorithm", async () => {
    const bad = { algo: "md5", value: "abc", covered: ["tables"] } as unknown as IntegrityEnvelope;
    const res = await verifyIntegrity(payload, bad);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/Unsupported checksum algorithm/);
  });

  it("does not throw when handed null/undefined (hardened envelope)", async () => {
    const res = await verifyIntegrity(
      payload,
      null as unknown as IntegrityEnvelope,
    );
    expect(res.ok).toBe(false);
  });

  it("normalizes undefined and digest-only envelopes without direct property crashes", () => {
    expect(normalizeIntegrityEnvelope(undefined, payload)).toBeNull();
    expect(normalizeIntegrityEnvelope({ digest: "abc" }, payload)).toEqual({
      algo: INTEGRITY_ALGO,
      value: "abc",
      covered: Object.keys(payload).sort(),
    });
  });

  it("falls back when Web Crypto subtle.digest is unavailable", async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {},
    });
    try {
      await expect(sha256Hex("fallback-ok")).resolves.toMatch(/^[0-9a-f]{64}$/);
    } finally {
      if (original) Object.defineProperty(globalThis, "crypto", original);
    }
  });
});

describe("parseRestoreSnapshotJson — import fixtures", () => {
  const snapshotPayload = {
    app: "bostead" as const,
    version: 1 as const,
    tables: payload.tables.map((table) => ({ table: table.name, rows: table.rows })),
  };

  it("accepts a current integrity envelope", async () => {
    const integrity = await computeIntegrity(snapshotPayload);
    const res = await parseRestoreSnapshotJson(
      JSON.stringify({
        generated_at: payload.exportedAt,
        generated_by: payload.userId,
        ...snapshotPayload,
        integrity,
      }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.integrity.kind).toBe("verified");
  });

  it("accepts a legacy digest-only envelope", async () => {
    const digest = await sha256Hex(canonicalStringify(snapshotPayload));
    const res = await parseRestoreSnapshotJson(
      JSON.stringify({
        generated_at: payload.exportedAt,
        generated_by: payload.userId,
        ...snapshotPayload,
        integrity: { digest },
      }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.integrity.kind).toBe("verified");
  });

  it("treats missing integrity as a legacy import instead of throwing", async () => {
    const res = await parseRestoreSnapshotJson(
      JSON.stringify({
        generated_at: payload.exportedAt,
        generated_by: payload.userId,
        ...snapshotPayload,
      }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.integrity.kind).toBe("missing");
  });

  it("returns a clean mismatch for an integrity object missing checksum fields", async () => {
    const res = await parseRestoreSnapshotJson(
      JSON.stringify({
        generated_at: payload.exportedAt,
        generated_by: payload.userId,
        ...snapshotPayload,
        integrity: { algo: INTEGRITY_ALGO },
      }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/integrity check failed/i);
  });

  it("returns parse debug for truncated JSON before any restore request", async () => {
    const res = await parseRestoreSnapshotJson(
      '{"app":"bostead","version":1,"tables":[{"table":"tasks","rows":[',
      { fileName: "broken.json", fileSize: 64, lastModified: 123 },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toMatch(/truncated|incomplete/i);
      expect(res.debug?.stage).toBe("local-file-parse");
      expect(res.debug?.request.sentToServer).toBe(false);
      expect(res.debug?.file?.name).toBe("broken.json");
      expect(res.debug?.diagnostics.looksTruncated).toBe(true);
    }
  });

  it("accepts common JSON wrappers and repairs trailing commas", async () => {
    const res = await parseRestoreSnapshotJson(
      `\uFEFF\`\`\`json\n${JSON.stringify({
        generated_at: payload.exportedAt,
        generated_by: payload.userId,
        ...snapshotPayload,
      }).replace(/}$/, ',}')}\n\`\`\``,
    );
    expect(res.ok).toBe(true);
  });
});

describe("restore import row scoping", () => {
  it("rewrites exported row user_id values to the restoring admin id", () => {
    const restoringUserId = "00000000-0000-0000-0000-000000000099";
    const rows = [
      {
        id: "task-1",
        user_id: "00000000-0000-0000-0000-000000000001",
        title: "Portable backup row",
      },
      {
        id: "task-2",
        user_id: "00000000-0000-0000-0000-000000000002",
        title: "Another backup row",
      },
    ];

    expect(scopeRestoreRowsToUser(rows, restoringUserId)).toEqual([
      { ...rows[0], user_id: restoringUserId },
      { ...rows[1], user_id: restoringUserId },
    ]);
    expect(rows[0].user_id).toBe("00000000-0000-0000-0000-000000000001");
  });

  it("leaves rows without owner fields unchanged", () => {
    const rows = [{ id: "row-1", name: "No owner column" }];
    expect(scopeRestoreRowsToUser(rows, "00000000-0000-0000-0000-000000000099")).toEqual(rows);
  });
});

describe("verifyIntegrity — covered-subset envelopes (forward-compat)", () => {
  it("only hashes fields listed in `covered`", async () => {
    // Build an envelope that only covers `tables`.
    const value = await sha256Hex(canonicalStringify({ tables: payload.tables }));
    const env: IntegrityEnvelope = {
      algo: INTEGRITY_ALGO,
      value,
      covered: ["tables"],
    };
    // Changing an uncovered field must still verify.
    const res = await verifyIntegrity(
      { ...payload, exportedAt: "different" },
      env,
    );
    expect(res.ok).toBe(true);
  });
});
