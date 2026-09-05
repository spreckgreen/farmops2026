
## Farm Shop grid-reference migration (preview only)
- [x] Old grid (A–G / 1–6, A6 = NE) → new corrected grid (A–F / 1–9, 40'x60') physical-position remap
- [x] Preview route + CSV, PNL-FS-NW / PNL-FS-NE included, ambiguous locations flagged
- [ ] Owner disposition of REVIEW rows, then an apply gate (not built yet — no writes)

## Document generation (PDF) from the Electrical API
- [ ] /electrical/documents screen calling /api/electrical/v1: Farm Shop electrical sheet, Avery labels, grid map as PDFs
- [ ] Embedded version stamp on every generated document/file so users can verify which version of the truth they are reading

## Grid map legacy-coordinate regression
- [x] Plot unmigrated load/panel `grid` values through the frozen legacy A–G / 1–6 transformation
- [x] Prefer recorded X/Y, then corrected `grid_reference`, without changing underlying records

## Self-hosted Docker build memory reliability
- [x] Enforce the Node heap cap in the Vite child process
- [x] Preserve native bundler/host memory when automatically sizing the heap
- [x] Release completed Vite environments between client, SSR, and Nitro phases
- [x] Report child and cgroup memory in build heartbeats
- [x] Bound Rolldown native worker pools and provide temporary build-only swap on low-memory hosts
- [x] Use memory-capped Rollup for Docker server packaging and pause local AI during low-memory builds
