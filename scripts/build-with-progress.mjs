#!/usr/bin/env node
/**
 * Wrap `vite build` with progress/heartbeat logging and fail-fast guards so
 * stalls during Docker / nginx-SSL deploys are visible instead of looking hung.
 *
 * Env vars:
 *   BUILD_HEARTBEAT_SECS   Heartbeat interval (default 10s)
 *   BUILD_STALL_SECS       Kill if no stdout/stderr for this long (default 180s)
 *   BUILD_MAX_SECS         Hard ceiling for entire build (default 1800s = 30min)
 *   BUILD_QUIET            "1" filters noisy "use client" directive warnings
 *
 * Usage: node scripts/build-with-progress.mjs [--mode development] [extra vite args]
 */
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

const HEARTBEAT_MS = Number(process.env.BUILD_HEARTBEAT_SECS ?? 10) * 1000;
const STALL_MS = Number(process.env.BUILD_STALL_SECS ?? 180) * 1000;
const MAX_MS = Number(process.env.BUILD_MAX_SECS ?? 1800) * 1000;
const QUIET = process.env.BUILD_QUIET === "1";

const start = performance.now();
const fmt = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
};
const stamp = () => new Date().toISOString().slice(11, 19);
const log = (msg) => console.log(`[build ${stamp()} +${fmt(performance.now() - start)}] ${msg}`);

// Track phase markers so the log shows progress through Vite/Nitro stages.
const PHASES = [
  { re: /transforming\.\.\./i, name: "transform" },
  { re: /rendering chunks/i, name: "render-chunks" },
  { re: /computing gzip size/i, name: "gzip" },
  { re: /built in /i, name: "client-built" },
  { re: /\[nitro\]/i, name: "nitro" },
  { re: /Σ Total size/i, name: "nitro-summary" },
  { re: /You can preview this build/i, name: "done" },
];
const seen = new Set();

log(`starting vite build (heartbeat=${HEARTBEAT_MS / 1000}s stall=${STALL_MS / 1000}s max=${MAX_MS / 1000}s)`);
log(`node=${process.version} platform=${process.platform} cwd=${process.cwd()}`);
log(`NITRO_PRESET=${process.env.NITRO_PRESET ?? "(default)"}`);

const args = ["vite", "build", ...process.argv.slice(2)];
const child = spawn("bunx", args, {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, FORCE_COLOR: "0" },
});

let lastOutput = performance.now();
const bump = () => {
  lastOutput = performance.now();
};

const wire = (stream, label) => {
  let buf = "";
  stream.on("data", (chunk) => {
    bump();
    buf += chunk.toString();
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (QUIET && /"use client" in "node_modules\//.test(line)) continue;
      process[label === "stderr" ? "stderr" : "stdout"].write(line + "\n");
      for (const phase of PHASES) {
        if (!seen.has(phase.name) && phase.re.test(line)) {
          seen.add(phase.name);
          log(`phase: ${phase.name}`);
        }
      }
    }
  });
};
wire(child.stdout, "stdout");
wire(child.stderr, "stderr");

const heartbeat = setInterval(() => {
  const idle = performance.now() - lastOutput;
  log(`heartbeat — idle ${fmt(idle)}, phases done: ${[...seen].join(",") || "(none yet)"}`);
}, HEARTBEAT_MS);

const stallTimer = setInterval(() => {
  if (performance.now() - lastOutput > STALL_MS) {
    log(`STALL: no output for >${STALL_MS / 1000}s. Killing build.`);
    clearAll();
    child.kill("SIGKILL");
    process.exitCode = 124;
  }
}, 5000);

const maxTimer = setTimeout(() => {
  log(`TIMEOUT: build exceeded ${MAX_MS / 1000}s. Killing.`);
  clearAll();
  child.kill("SIGKILL");
  process.exitCode = 124;
}, MAX_MS);

function clearAll() {
  clearInterval(heartbeat);
  clearInterval(stallTimer);
  clearTimeout(maxTimer);
}

child.on("exit", (code, signal) => {
  clearAll();
  log(`vite build exited code=${code} signal=${signal ?? "none"} elapsed=${fmt(performance.now() - start)}`);
  if (code !== 0) {
    log(`FAIL — last phase reached: ${[...seen].pop() ?? "(none)"}`);
    process.exit(code ?? 1);
  }
  log(`SUCCESS — phases: ${[...seen].join(",") || "(none detected)"}`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    log(`received ${sig}, forwarding to child`);
    child.kill(sig);
  });
}
