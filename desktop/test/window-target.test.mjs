import test from "node:test";
import assert from "node:assert/strict";
import { shouldLoadRemoteDesktopUi } from "../src/window-target.mjs";

test("desktop stays local by default even when a remote URL is present", () => {
  assert.equal(
    shouldLoadRemoteDesktopUi({ FARMOPS_DESKTOP_URL: "http://localhost:8080" }),
    false,
  );
});

test("desktop only loads remote UI when explicitly opted in", () => {
  assert.equal(
    shouldLoadRemoteDesktopUi({
      FARMOPS_DESKTOP_URL: "http://localhost:8080",
      FARMOPS_DESKTOP_ALLOW_REMOTE_UI: "true",
    }),
    true,
  );
});

test("desktop refuses remote mode without a URL", () => {
  assert.equal(
    shouldLoadRemoteDesktopUi({ FARMOPS_DESKTOP_ALLOW_REMOTE_UI: "true" }),
    false,
  );
});
