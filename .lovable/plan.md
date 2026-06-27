## Goal

Add a persistent, timestamped installation log so when `docker compose build` (or a local install) fails, you can see exactly which stage and command broke — instead of squinting at scrollback behind nginx.

## What gets logged

Every phase writes to a single log file with a stage tag, timestamp, command, and exit status:

```
[2026-06-27T00:51:14Z] [preflight]  START  bash scripts/docker-preflight.sh
[2026-06-27T00:51:15Z] [preflight]  OK     (0.8s)
[2026-06-27T00:51:15Z] [deps]       START  bun install --frozen-lockfile
[2026-06-27T00:53:02Z] [deps]       OK     (107s)
[2026-06-27T00:53:02Z] [build]      START  bun run build:ci
[2026-06-27T00:57:41Z] [build]      FAIL   exit=1 (279s)
[2026-06-27T00:57:41Z] [build]      --- last 80 lines of stage output ---
...
```

Stages tracked: `preflight`, `deps`, `build`, `nitro-detect`, `runner-install`.

## Pieces to add

1. **`scripts/install-log.sh`** — small bash helper sourced or invoked by every stage:
   - `log_stage_start <name> <cmd…>` / `log_stage_end <name> <status> <elapsed>`
   - Writes to `${INSTALL_LOG:-/tmp/bostead-install.log}` *and* echoes to stdout.
   - On failure: appends last 80 lines of that stage's captured output plus any line matching `error|failed|cannot|denied|oom|killed|timeout`.
   - Pure POSIX bash, no extra deps; works locally and inside the slim Bun image.

2. **`scripts/docker-preflight.sh`** — wrap its body with `log_stage_start preflight` / `log_stage_end`.

3. **`Dockerfile`** — every existing `RUN` for deps / build / nitro-detect / runner-install gets:
   - Stage tag echoed at start and end.
   - Output tee'd through `install-log.sh` to `/tmp/bostead-install.log`.
   - On failure, the helper prints the captured tail to stderr (so `docker build` shows it inline) *and* the log path.
   - A final builder-stage `RUN` copies `/tmp/bostead-install.log` to `/app/dist/install.log` so it survives into the runner image for inspection via `docker cp`.

4. **`docker-compose.yml`** — add a bind mount `./logs:/var/log/bostead` so the runtime log (and a copy of the build log on container start, done by `docker-entrypoint.sh`) lands on the host at `./logs/install.log` for easy `tail -f`.

5. **`docker-entrypoint.sh`** — on container start, copy `/app/dist/install.log` to `/var/log/bostead/install.log` if the mount exists, so build-time failures are visible from the host even after the image is shipped.

6. **`README.md`** — short "Where to find install logs" subsection under the Docker install section: log path inside the image, host bind path, how to grep for `FAIL`.

## How you'll use it

- **Build fails** → `docker compose build` prints the stage tag and the captured tail right where it died. The full log is still in the failed builder layer; rerun with `--progress=plain` to scroll, or `docker build --target builder -o type=local,dest=./out .` to extract.
- **Local install fails** → `INSTALL_LOG=./install.log bash scripts/docker-preflight.sh` (and same pattern for any local install script) drops the log in your repo root.
- **Runtime debugging** → `tail -f ./logs/install.log` on the host shows the snapshot from build time.

## Out of scope

- No change to what's actually built or installed.
- No new dependencies.
- Doesn't replace `build-with-progress.mjs` heartbeats — those still drive per-line Vite progress; this layer is the cross-stage summary on top.

## Files touched

- new: `scripts/install-log.sh`
- edit: `scripts/docker-preflight.sh`, `Dockerfile`, `docker-compose.yml`, `docker-entrypoint.sh`, `README.md`
