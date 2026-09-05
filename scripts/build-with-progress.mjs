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
  { re: /generating bundle/i, name: "rollup-generate" },
  { re: /writing.*(assets|bundle)/i, name: "rollup-write" },
  { re: /computing gzip size/i, name: "gzip" },
  { re: /built in /i, name: "client-built" },
  { re: /\[nitro\]/i, name: "nitro" },
  { re: /Σ Total size/i, name: "nitro-summary" },
  { re: /You can preview this build/i, name: "done" },
];
const seen = new Set();

// Read host memory once at startup, then RSS deltas on each heartbeat.
import { readFileSync } from "node:fs";
function hostMemMB() {
  try {
    const m = readFileSync("/proc/meminfo", "utf8");
    const total = /MemTotal:\s+(\d+)/.exec(m)?.[1];
    const avail = /MemAvailable:\s+(\d+)/.exec(m)?.[1];
    if (!total) return null;
    return { totalMB: Math.round(+total / 1024), availMB: avail ? Math.round(+avail / 1024) : null };
  } catch {
    return null;
  }
}
function processRssMB(pid) {
  try {
    const status = readFileSync(`/proc/${pid}/status`, "utf8");
    const rss = /VmRSS:\s+(\d+)/.exec(status)?.[1];
    return rss ? Math.round(Number(rss) / 1024) : null;
  } catch {
    return null;
  }
}
function cgroupMemMB() {
  for (const file of ["/sys/fs/cgroup/memory.current", "/sys/fs/cgroup/memory/memory.usage_in_bytes"]) {
    try {
      const bytes = Number(readFileSync(file, "utf8").trim());
      if (Number.isFinite(bytes)) return Math.round(bytes / 1024 / 1024);
    } catch {
      // Try the next cgroup layout.
    }
  }
  return null;
}
const HOST = hostMemMB();
const HEAP_CAP = /max-old-space-size=(\d+)/.exec(process.env.NODE_OPTIONS ?? "")?.[1];

// Ensure a safe default AI backend is selected at build time so any prerender
// or module-load path that eagerly initializes the AI provider does not fail
// with "Missing AI credentials". These match the bundled Ollama service in
// docker-compose.yml and are overridden by real values in .env / runtime.
// Setting them here (build-time only) never overrides an operator's config
// because we only fill in blanks.
const DEFAULT_AI = {
  CUSTOM_AI_BASE_URL: "http://ollama:11434/v1",
  CUSTOM_AI_API_KEY: "ollama",
  CUSTOM_AI_MODEL: "llama3.2:3b",
};
const aiApplied = [];
for (const [k, v] of Object.entries(DEFAULT_AI)) {
  if (!process.env[k]) {
    process.env[k] = v;
    aiApplied.push(k);
  }
}
if (aiApplied.length) {
  log(`AI defaults applied for build: ${aiApplied.join(", ")} (override in .env for prod)`);
} else {
  log(`AI env already configured (CUSTOM_AI_* set) — leaving as-is`);
}

log(`starting vite build (heartbeat=${HEARTBEAT_MS / 1000}s stall=${STALL_MS / 1000}s max=${MAX_MS / 1000}s)`);
log(`node=${process.version} platform=${process.platform} cwd=${process.cwd()}`);
log(
  `NITRO_PRESET=${process.env.NITRO_PRESET ?? "(default)"} NITRO_BUILDER=${process.env.NITRO_BUILDER ?? "(auto)"} BUILD_LOW_MEM=${process.env.BUILD_LOW_MEM ?? "0"}`,
);
log(`heap cap=${HEAP_CAP ?? "(node default)"}MB host=${HOST ? `${HOST.totalMB}MB total, ${HOST.availMB}MB avail` : "(unknown)"}`);
log(
  `native workers: rolldown=${process.env.ROLLDOWN_WORKER_THREADS ?? "default"} blocking=${process.env.ROLLDOWN_MAX_BLOCKING_THREADS ?? "default"} rayon=${process.env.RAYON_NUM_THREADS ?? "default"}`,
);

// IMPORTANT: run Vite under **node**, not `bunx`.
// Bun's JS engine ignores NODE_OPTIONS=--max-old-space-size, so the heap cap
// above is silently dropped and the Nitro/SSR pass grows until the host OOM
// killer SIGKILLs it (symptom: `signal=SIGKILL`, host-avail near 0 MB, while
// wrapper-rss stays tiny because the memory is in the child). Node honours the
// cap and fails with a clean heap error instead of taking the host down.
import { existsSync } from "node:fs";
import path from "node:path";

const viteBin = ["node_modules/vite/bin/vite.js", "../node_modules/vite/bin/vite.js"]
  .map((p) => path.resolve(process.cwd(), p))
  .find((p) => existsSync(p));

const viteArgs = ["build", ...process.argv.slice(2)];
const spawnCmd = viteBin ? process.execPath : "bunx";
// Expose explicit GC so the low-memory Vite plugin can release the completed
// client/SSR module graph before Nitro starts its next environment build.
const spawnArgs = viteBin ? ["--expose-gc", viteBin, ...viteArgs] : ["vite", ...viteArgs];
log(
  viteBin
    ? `runner: node --expose-gc ${path.relative(process.cwd(), viteBin)} (heap cap enforced)`
    : `runner: bunx vite (vite bin not found — WARNING: heap cap is NOT enforced under bun)`,
);
const child = spawn(spawnCmd, spawnArgs, {
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
  const mu = process.memoryUsage();
  const rssMB = Math.round(mu.rss / 1024 / 1024);
  const host = hostMemMB();
  const hostStr = host?.availMB != null ? ` host-avail=${host.availMB}MB` : "";
  const childRss = processRssMB(child.pid);
  const childStr = childRss == null ? "" : ` vite-rss=${childRss}MB`;
  const cgroup = cgroupMemMB();
  const cgroupStr = cgroup == null ? "" : ` cgroup=${cgroup}MB`;
  log(`heartbeat — idle ${fmt(idle)} wrapper-rss=${rssMB}MB${childStr}${cgroupStr}${hostStr} phases: ${[...seen].join(",") || "(none yet)"}`);
}, HEARTBEAT_MS);

// Stall detection is advisory only. Vite is largely silent in non-TTY mode
// (Docker) during long transform/render phases, so killing on silence
// produces false-positive failures. Log a warning instead of killing; the
// hard MAX_MS ceiling still guarantees the build can't hang forever.
let warnedStall = false;
const stallTimer = setInterval(() => {
  if (performance.now() - lastOutput > STALL_MS && !warnedStall) {
    warnedStall = true;
    log(`WARN: no output for >${STALL_MS / 1000}s (Vite is often silent during transform in non-TTY). Build continues; hard cap is ${MAX_MS / 1000}s.`);
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
    const lastPhase = [...seen].pop() ?? "(none)";
    log(`FAIL — last phase reached: ${lastPhase}`);
    // OOM signature: SIGKILL with no exit code, or code 134/137, or an
    // unfinished transform phase on a tight heap. Surface a targeted hint
    // so the install log clearly points at memory, not at a code bug.
    const looksOom =
      signal === "SIGKILL" ||
      code === 137 ||
      code === 134 ||
      (lastPhase === "transform" && HEAP_CAP && Number(HEAP_CAP) <= 3072);
    if (looksOom) {
      const host = hostMemMB();
      log(
        `FAIL: likely OOM — heap cap was ${HEAP_CAP ?? "(default)"}MB, host has ${
          host?.totalMB ?? "?"
        }MB total. Native Rolldown memory exhausted the host; on an 8 GB self-hosted machine, stop the local AI service during the build or provide swap.`,
      );
    }
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
