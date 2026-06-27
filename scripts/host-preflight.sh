#!/usr/bin/env bash
# Preflight: check the host has enough memory + swap to run the Docker build.
# Run BEFORE `docker compose build` / `docker buildx build` on small VPS hosts.
set -u

total_mb=$(awk '/MemTotal/  {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 0)
avail_mb=$(awk '/MemAvailable/{printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 0)
swap_mb=$( awk '/SwapTotal/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 0)

echo "Host memory: total=${total_mb}MB available=${avail_mb}MB swap=${swap_mb}MB"

problems=0
if [ "$total_mb" -lt 3500 ]; then
  echo "WARN: less than 4 GB RAM. Build will likely fail without swap."
  problems=1
fi
if [ "$swap_mb" -lt 1024 ] && [ "$total_mb" -lt 6000 ]; then
  echo "WARN: no/low swap on a <6 GB host. Recommend at least 2 GB swap:"
  cat <<'EOS'
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
EOS
  problems=1
fi
if [ "$avail_mb" -lt 2000 ]; then
  echo "WARN: only ${avail_mb}MB available right now. Free memory before building (stop other containers, kill stray node processes)."
  problems=1
fi

# Suggested heap = max(1024, avail - 1024), capped at 4096
suggested=$(( avail_mb - 1024 ))
[ "$suggested" -lt 1024 ] && suggested=1024
[ "$suggested" -gt 4096 ] && suggested=4096
echo ""
echo "Suggested build command:"
echo "  docker buildx build --build-arg NODE_HEAP_MB=${suggested} -t bostead:local ."

exit $problems
