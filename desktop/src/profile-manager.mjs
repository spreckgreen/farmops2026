import fs from "node:fs";
import path from "node:path";
import { profilePaths } from "./profile-paths.mjs";

export function initializeProfile(userDataRoot, profileType) {
  const profile = profilePaths(userDataRoot, profileType);
  fs.mkdirSync(profile.attachments, { recursive: true });
  fs.mkdirSync(profile.configuration, { recursive: true });
  return profile;
}

export function resetDisposableProfile(userDataRoot, profileType) {
  if (profileType === "live") throw new Error("Live profiles require the audited clear-site workflow");
  const target = profilePaths(userDataRoot, profileType);
  const live = profilePaths(userDataRoot, "live");
  if (target.root === live.root || target.root.startsWith(live.root + path.sep)) throw new Error("Refusing to reset Live Farm data");
  fs.rmSync(target.root, { recursive: true, force: true });
  return initializeProfile(userDataRoot, profileType);
}
