# AI Hosting — sizing & backend selection

Practical guidance on choosing the AI backend for FarmOps. The app supports
three provider modes through a single set of env vars — the decision is about
**hardware, cost, and quality**, not code changes.

All three paths use the same three env vars in `.env` / `.env.local`:

```bash
CUSTOM_AI_BASE_URL=<OpenAI-compatible /v1 endpoint>
CUSTOM_AI_API_KEY=<bearer token; use "ollama" for local Ollama>
CUSTOM_AI_MODEL=<model id>
```

The Planner + Executor architecture used by the schedule generator, symptom
mapper, and consultant chat is designed so **model quality mostly affects
plan quality, not app stability** — bad plans get rejected in the preview UI
before any DB writes happen. That's what makes the hybrid path below viable.

---

## Which quality tier do you need?

| Tier | Models | VRAM/RAM at Q4 | FarmOps features that need this tier |
| --- | --- | --- | --- |
| Light | Llama 3.2 1B–3B, Phi-3 Mini | 2–4 GB | Note co-writing, tag suggestions, weekly summary drafts |
| Mid | Qwen2.5 14B, Llama 3.1 8B–13B | 8–12 GB | Consultant chat, symptom → procedure, preservation coach |
| Heavy | Qwen2.5 32B, Llama 3.3 70B | 20–42 GB | Schedule planner (structured JSON), forecast narratives |
| Frontier | GPT-4o, Claude 3.5 Sonnet, Gemini 2.5 Pro | N/A (API) | Any workflow where you want the model to research + reason like ChatGPT |

Rule of thumb: **anything that returns structured JSON to the executor
(schedule planner, action framework) benefits most from Heavy or Frontier.**
Small models miss schemas 15–30% of the time — retries mask it but latency
suffers.

---

## Path A — Hybrid (recommended)

**Cost:** ~$5–15/month OpenAI API. **Hardware:** none new.

Use a paid API (OpenAI, Anthropic via OpenRouter, Gemini) for reasoning-heavy
calls. Skip local AI entirely, or keep bundled Ollama running `llama3.2:1b`
as an offline fallback.

```bash
# OpenAI directly
CUSTOM_AI_BASE_URL=https://api.openai.com/v1
CUSTOM_AI_API_KEY=sk-proj-...
CUSTOM_AI_MODEL=gpt-4o-mini    # or gpt-4o for the planner

# Or OpenRouter (access to Anthropic/Gemini/Llama 70B under one bill)
CUSTOM_AI_BASE_URL=https://openrouter.ai/api/v1
CUSTOM_AI_API_KEY=sk-or-v1-...
CUSTOM_AI_MODEL=anthropic/claude-3.5-sonnet
```

**Cost model** (gpt-4o-mini @ $0.15/M input, $0.60/M output):

- Typical FarmOps call: ~3k tokens in, ~500 out ≈ **$0.001/call**.
- 500 calls/month ≈ **$0.50**. Even heavy use rarely exceeds **$10/month**.
- Upgrade individual features to gpt-4o (~15× cost) if quality matters —
  the planner alone benefits, everything else stays on mini.

**When to pick this:** you already pay for ChatGPT/Claude, your VPS has no
GPU, or you tried a local 3B model and hit OOM (bundled Ollama at
`llama3.2:3b` needs ~4 GB free RAM — many small VPSes don't have it).

---

## Path B — Self-hosted "Mid" tier (~$1,400 build)

**Cost:** one-time hardware. **Quality ceiling:** Qwen2.5 32B at ~10 tok/s.

Best build at this budget:

| Part | Choice | ~Price |
| --- | --- | --- |
| GPU | Used RTX 3090 24 GB | $750 |
| CPU | Ryzen 7 5700X | $150 |
| RAM | 64 GB DDR4 3200 | $110 |
| Motherboard | B550 | $130 |
| NVMe | 1 TB Gen4 | $70 |
| PSU | 850W Gold | $110 |
| Case + fans | | $100 |
| **Total** | | **~$1,420** |

**What it runs well:**

- ✅ Qwen2.5 14B Q5 at 30+ tok/s — great for consultant chat, symptom
  matching, note drafting.
- ✅ Qwen2.5 32B Q4 at ~10–12 tok/s — usable for the planner if you can
  wait 20–30s per response.
- ⚠️ Llama 3.3 70B: only at Q2, where quality drops below 14B. Skip.

Setup:

```bash
# On the GPU host
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen2.5:14b-instruct-q5_K_M
# expose Ollama on the LAN by editing the systemd service:
#   Environment="OLLAMA_HOST=0.0.0.0:11434"

# On the FarmOps host, in .env / .env.local
CUSTOM_AI_BASE_URL=http://<gpu-host>:11434/v1
CUSTOM_AI_API_KEY=ollama
CUSTOM_AI_MODEL=qwen2.5:14b-instruct-q5_K_M
```

**When to pick this:** you want data locality (no farm data leaves the LAN),
you already have space/power for a mid-tower, and you accept "mid-tier"
structured-output quality on the planner.

**Skip anything cheaper.** CPU-only inference on 7B+ models runs at 2–5
tok/s on typical VPS hardware — the consultant chat will feel broken.

---

## Path C — Apple Silicon (Mac Mini/Studio, ~$2,200+)

**Cost:** $2,200 (M4 Pro 48 GB Mac Mini) to $6,000 (M2/M4 Ultra Mac Studio).

Unified memory means all 48/64/192 GB is usable as VRAM. Best perf/watt in
this class — ~40W under load vs. 400W for the 3090 build. Silent, fits on
a shelf.

- M4 Pro Mac Mini 48 GB (~$2,200): runs 32B Q4 at ~15 tok/s, 70B Q4 at
  ~6 tok/s.
- M2/M4 Ultra Mac Studio 64–192 GB ($4k–$6k): runs 70B Q4 comfortably,
  can even fit 70B Q6 or 123B.

Setup uses Ollama identically to Path B. The Mac just needs to expose
Ollama on the LAN and stay awake.

**When to pick this:** budget flexes above $2k, you value silence and low
power draw, or you already have a Mac you'd repurpose.

---

## Why $1,500 can't run 32B–70B locally

Common ask, honest answer:

- 32B Q4 needs ~20 GB VRAM. Only a used **RTX 3090 24 GB** (~$750) meets
  it at this budget. The rest of the build (PSU, board, RAM, case) is
  another $650–$700. Total lands at $1,400–$1,600 before tax.
- 70B Q4 needs ~42 GB. Requires 2× 3090 or an RTX A6000 48 GB (~$3,500
  used). Not achievable under $1,500 on a single box in 2026.
- CPU-only inference on 32B+ models is ~1–2 tok/s. Technically running,
  practically unusable.

If your budget is a hard $1,500 and you want Heavy-tier quality, **use
Path A** — a $10/month OpenAI bill buys the equivalent of a $10,000 GPU
rig's output for typical FarmOps workloads.

---

## Switching backends

All three paths are the same three env vars. To switch:

1. Update `CUSTOM_AI_BASE_URL`, `CUSTOM_AI_API_KEY`, `CUSTOM_AI_MODEL` in
   `.env` / `.env.local`.
2. `docker compose up -d app` (or restart the Node process).
3. Verify at **Settings → Self-host → Run AI test**. Look for:
   - `provider`: `custom` (Path A/B/C) or `lovable` (managed).
   - `ok: true` and a latency you're happy with.

The Self-host settings page also has a model picker that lists what your
provider currently exposes and lets you switch models without editing env
files.

---

## FAQ

**Can I mix providers per feature?**
Not today — one `CUSTOM_AI_MODEL` at a time. Feature-level model selection
is a possible future enhancement.

**What about privacy on Path A?**
OpenAI's API (unlike ChatGPT web) is not trained on by default. Anthropic
via OpenRouter has the same guarantee. Read each provider's data policy.
If privacy is non-negotiable, Path B/C is the answer.

**Do I need the bundled Ollama service if I'm on Path A?**
No. Comment out the `ollama` and `ollama-pull` services in
`docker-compose.yml` to save ~2 GB disk and ~200 MB RAM.
