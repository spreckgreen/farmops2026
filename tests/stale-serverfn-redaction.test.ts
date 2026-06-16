import { describe, expect, it } from "vitest";
import {
  maskSegment,
  redactPath,
  redactRoute,
  redactUrl,
} from "@/hooks/use-stale-serverfn-guard";

describe("maskSegment", () => {
  it("masks UUIDs", () => {
    expect(maskSegment("3262d5a9-40fd-4cf4-a353-9549a732cb96")).toBe("[uuid]");
    expect(maskSegment("3262D5A9-40FD-4CF4-A353-9549A732CB96")).toBe("[uuid]");
  });

  it("masks JWTs (three dot-separated base64url parts)", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    expect(maskSegment(jwt)).toBe("[jwt]");
  });

  it("masks long hex tokens", () => {
    expect(maskSegment("a1b2c3d4e5f60718293a4b5c")).toBe("[hex]");
    expect(maskSegment("DEADBEEFCAFEBABE12345678")).toBe("[hex]");
  });

  it("masks long numeric IDs", () => {
    expect(maskSegment("123456")).toBe("[id]");
    expect(maskSegment("9876543210")).toBe("[id]");
  });

  it("masks emails", () => {
    expect(maskSegment("user@example.com")).toBe("[email]");
  });

  it("masks opaque base64url tokens >= 20 chars", () => {
    expect(maskSegment("AbCdEf_GhIjKl-MnOpQrSt")).toBe("[token]");
  });

  it("preserves readable slugs and short segments", () => {
    expect(maskSegment("notes")).toBe("notes");
    expect(maskSegment("2026-06-16")).toBe("2026-06-16"); // date slug, not bare digits
    expect(maskSegment("tasks")).toBe("tasks");
    expect(maskSegment("backlog")).toBe("backlog");
    expect(maskSegment("12345")).toBe("12345"); // <6 digits stays
    expect(maskSegment("abc123")).toBe("abc123"); // mixed short slug
    expect(maskSegment("my-cool-post")).toBe("my-cool-post");
  });
});

describe("redactPath", () => {
  it("masks identifier segments while keeping static ones", () => {
    expect(
      redactPath("/users/3262d5a9-40fd-4cf4-a353-9549a732cb96/posts/123456"),
    ).toBe("/users/[uuid]/posts/[id]");
  });

  it("preserves entirely readable paths", () => {
    expect(redactPath("/notes/2026-06-16")).toBe("/notes/2026-06-16");
    expect(redactPath("/tasks/backlog")).toBe("/tasks/backlog");
  });

  it("masks the hashed serverFn ID segment", () => {
    // Long base64url-style hashed ID → [token]
    expect(
      redactPath("/_serverFn/eyJmaWxlIjoiL3NyYy9saWIvbG9nLmZ1bmN0aW9ucy50cyJ9"),
    ).toBe("/_serverFn/[token]");
  });
});

describe("redactUrl", () => {
  it("strips query values, keeps keys, drops fragments, and masks the path", () => {
    const out = redactUrl(
      "https://app.example.com/users/3262d5a9-40fd-4cf4-a353-9549a732cb96?token=secret&page=2#access_token=abc",
    );
    expect(out).toBe(
      "https://app.example.com/users/[uuid]?token=%5Bredacted%5D&page=%5Bredacted%5D",
    );
    expect(out).not.toContain("secret");
    expect(out).not.toContain("access_token");
  });

  it("returns a path-only string when given a bare path (no origin)", () => {
    const out = redactUrl("/users/3262d5a9-40fd-4cf4-a353-9549a732cb96?token=t#x");
    expect(out).toContain("/users/[uuid]");
    expect(out).not.toContain("#");
    expect(out).not.toContain("=t");
  });

});

describe("redactRoute", () => {
  it("masks path and strips query values", () => {
    expect(redactRoute("/users/123456", "?email=a@b.com&tab=profile")).toBe(
      "/users/[id]?email=%5Bredacted%5D&tab=%5Bredacted%5D",
    );
  });

  it("returns the masked path unchanged when there is no search string", () => {
    expect(redactRoute("/notes/2026-06-16", "")).toBe("/notes/2026-06-16");
  });
});
