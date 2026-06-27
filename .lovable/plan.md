## Problem

Docker build reaches `builder 8/10` (`bun run build:ci` → Vite+Nitro) and runs until the 2700s hard cap kills it. On a 4 GB host this is almost certainly memory starvation: Node is launched with `--max-old-space-size=4096`, which equals the host's entire RAM. The kernel ends up swapping (or the OOM killer pauses progress without printing a clean error), so Vite makes no measurable progress and the stall guard / max timer eventually fires.

The fix is to stop competing with the host for memory and to add real visibility into what Vite is doing during that 45-minute window so we can confirm the diagnosis from the next run's log.

## Plan

### 1. Right-size Node heap for 4 GB hosts
- In `Dockerfile` builder stage, lower `NODE_OPTIONS` default from `--max-old-space-size=4096` to `--max-old-space-size=2560`, but allow override via build arg `NODE_HEAP_MB`.
- Add `ARG NODE_HEAP_MB=2560` so users on 8 GB+ hosts can pass `--build-arg NODE_HEAP_MB=6144`.
- Document the knob in `README.md` (Docker section): "If your host has ≤ 4 GB RAM, keep the default; on 8 GB+ pass `--build-arg NODE_HEAP_MB=6144`."

### 2. Reduce Vite peak memory
- In `vite.config.ts`, when `process.env.BUILD_LOW_MEM === "1"`, set:
  - `build.minify: "esbuild"` (already default, but force it; drop terser if pulled in)
  - `build.sourcemap: false`
  - `build.reportCompressedSize: false` (skips the gzip pass that doubles RAM near the end)
  - `build.rollupOptions.cache: false`
- Set `BUILD_LOW_MEM=1` in the Dockerfile builder stage so the in-container build always uses the lean settings; local dev is unaffected.

### 3. Make the stall visible instead of silent
- `scripts/build-with-progress.mjs`: shorten the default heartbeat from 10 s to 5 s inside Docker (`BUILD_HEARTBEAT_SECS=5` in Dockerfile) and add a memory line to each heartbeat (`process.memoryUsage().rss` of the wrapper plus a best-effort `/proc/meminfo` read for the host). This way the next failed log shows whether RSS is climbing, flat, or thrashing — distinguishing OOM from a genuine infinite loop.
- Add a new phase marker for Rollup's `generating bundle` / `writing assets` lines so we can tell whether the stall is in `transform` (most expensive) or later.

### 4. Fail fast and loud on OOM
- In `scripts/build-with-progress.mjs`, when the child exits with signal `SIGKILL` or code `137`, print a clear `FAIL: likely OOM — current heap cap was Xmb, host RAM is Ymb. Rebuild with --build-arg NODE_HEAP_MB=…` message before exiting.
- In `scripts/install-log.sh`, add `oom|killed|137|signal 9|out of memory` to the highlighted error patterns so the failure surface in `install.log` points straight at the cause.

### 5. README troubleshooting entry
Add a short "Docker build times out at builder 8/10" section to `README.md` linking the three knobs above (`NODE_HEAP_MB`, `BUILD_LOW_MEM`, host RAM guidance) and explaining how to read the new heartbeat memory line.

## Files touched

- `Dockerfile` — `ARG NODE_HEAP_MB`, lower default, set `BUILD_LOW_MEM=1`, set `BUILD_HEARTBEAT_SECS=5`.
- `vite.config.ts` — gated low-memory build options.
- `scripts/build-with-progress.mjs` — memory in heartbeat, OOM-aware exit message, extra phase markers.
- `scripts/install-log.sh` — extend `ERROR_GREP` with OOM patterns.
- `README.md` — Docker low-RAM troubleshooting note.

No application code or runtime behavior changes; this is build-pipeline only.

## What you'll do after I implement

Re-run the Docker build. Expected outcomes:
- On a 4 GB host the build should finish (smaller heap + skipped gzip-size pass keeps RSS under ~2.8 GB).
- If it still fails, the new heartbeat memory line and OOM-aware exit message will tell us definitively whether it's RAM, an infinite loop in a plugin, or something else — and we can target the next fix precisely instead of guessing.