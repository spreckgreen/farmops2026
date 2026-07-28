# Self-hosting AI for FarmOps — sizing recommendation

## The honest answer first

You picked **"Heavy (32B–70B, near-ChatGPT quality)"** and **"Under $1,500."** Those two constraints don't meet on a single box in 2026. Here's the math, then three realistic paths.

### Why $1,500 can't run 32B–70B well

Model size at Q4 quantization (the sweet spot for quality vs. memory):

| Model | VRAM/RAM needed | Tokens/sec you'd want | Reality on $1,500 |
|---|---|---|---|
| Llama 3.1 8B Q4 | ~6 GB | 30+ | ✅ Easy |
| Qwen2.5 14B Q4 | ~10 GB | 20+ | ✅ Achievable |
| Qwen2.5 32B Q4 | ~20 GB | 15+ | ⚠️ Only on used 3090 (24 GB), tight |
| Llama 3.3 70B Q4 | ~42 GB | 10+ | ❌ Needs 2×3090 or A6000 (~$4k+) |

A used **RTX 3090 24 GB** alone runs ~$700–$900. Add a host that can feed it (PSU 850W+, PCIe 4.0 board, 64 GB RAM, NVMe) and you're at $1,600–$2,000 before tax — and you still can't run 70B, only 32B at ~10 tok/s. Your current VPS has no GPU and (based on the earlier OOM on `llama3.2:3b`) not enough RAM to matter for CPU inference at this class.

## Three realistic paths

### Path A — Hybrid: keep ChatGPT for heavy lifting, self-host the small stuff (recommended)

**Cost: $0 extra hardware. ~$5–15/month OpenAI.**

Your codebase already supports this via `CUSTOM_AI_BASE_URL`. The Planner+Executor pattern we just shipped is designed for exactly this:

- **ChatGPT (gpt-4o-mini or gpt-4o)** handles: schedule planner, consultant chat, symptom→procedure, preservation coach, forecaster narratives.
- **Bundled Ollama on the VPS** handles: nothing critical — leave it off or run `llama3.2:1b` for offline fallback only.

Cost model: gpt-4o-mini is ~$0.15/M input, $0.60/M output. Your typical FarmOps call is 2–5k tokens in, 500 tokens out ≈ $0.001. Even 500 calls/month is under $1. gpt-4o is ~15× that.

You already have this wired. No code changes.

### Path B — $1,500 self-host, accept "Mid" quality ceiling

**Best build at this budget:**

| Part | Choice | ~Price |
|---|---|---|
| GPU | Used RTX 3090 24 GB | $750 |
| CPU | Ryzen 7 5700X | $150 |
| RAM | 64 GB DDR4 3200 | $110 |
| Board | B550 | $130 |
| NVMe | 1 TB Gen4 | $70 |
| PSU | 850W Gold | $110 |
| Case + fans | | $100 |
| **Total** | | **~$1,420** |

What it runs well:
- ✅ Qwen2.5 14B Q5 at 30+ tok/s (great for consultant chat, symptom matching, note drafting)
- ✅ Qwen2.5 32B Q4 at ~10–12 tok/s (usable for planner if you're patient)
- ⚠️ 70B: not really — Q2 fits but quality drops below 14B

Honest expectation: **matches Path A on the light features, noticeably worse on the schedule planner**. Small models still miss structured-JSON schemas ~15–30% of the time — the retry logic in the planner masks it but latency suffers.

### Path C — Apple Silicon Mac Mini M4 Pro 48 GB

**~$2,200** (over budget, but worth calling out).

Unified memory means the 48 GB is usable as VRAM. Runs 32B at ~15 tok/s and 70B Q4 at ~6 tok/s. Silent, sips power (~40W under load vs. 400W for the 3090 build), fits on a shelf. Best perf/watt in this class. If budget flexes, this beats Path B on every axis except raw peak throughput.

## My recommendation

**Go with Path A (hybrid).** Reasons specific to your setup:

1. You already OOM'd on 3B locally — jumping to 32B on the same VPS is a hardware swap, not a config change.
2. The Planner+Executor architecture we shipped last turn is *designed* to let a smart remote model plan and a dumb local process act. Using ChatGPT as the planner is the intended pattern.
3. Your ChatGPT subscription is already paid. Adding an API key ($5 minimum credit) unlocks gpt-4o-mini which handily beats a self-hosted 32B on structured output.
4. If OpenAI ever becomes a problem (privacy, cost spike, outage), the same env vars point at a local Ollama — zero code change.

If you want a self-hosted box anyway for privacy/independence, **Path B (used 3090 build, ~$1,400)** is the realistic floor. Skip anything cheaper; CPU-only inference on farm-consultant-sized prompts is 2–5 tok/s and will feel broken.

## Technical details

- All three paths use the existing `CUSTOM_AI_BASE_URL` / `CUSTOM_AI_API_KEY` / `CUSTOM_AI_MODEL` env vars in `.env.local`. No code changes needed to switch between them.
- The Planner+Executor split means model quality mostly affects *plan quality*, not whether the app breaks — bad plans get rejected in the preview UI before writes happen.
- For Path B/C, install Ollama, `ollama pull qwen2.5:14b-instruct-q5_K_M`, then set `CUSTOM_AI_BASE_URL=http://host:11434/v1`, `CUSTOM_AI_MODEL=qwen2.5:14b-instruct-q5_K_M`.

## Deliverable

This plan is advisory — no code changes proposed. If you want, on approval I can:

- **A**: Write a `docs/AI-HOSTING.md` capturing this recommendation for future reference.
- **B**: Update `docs/SELF_HOSTING.md` with a "Choose your AI backend" section covering the three paths.
- **C**: Both.

Pick one, or reject the plan and we'll just leave it in chat.
