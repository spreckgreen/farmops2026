# Remove Lovable AI engine

## Changes
- Reduce AI engine configuration to three choices: self-hosted, Ollama Cloud, and other OpenAI-compatible cloud.
- Remove Lovable AI cards, setup text, switch actions, health/setup affordances, and per-feature Lovable routing choices.
- Migrate existing saved selections that point to Lovable to a usable remaining default (`other_cloud`, then Ollama Cloud/local at runtime) without blocking saves.
- Keep API keys write-only: blank fields preserve stored keys, while entered keys save independently for each engine.
- Remove legacy runtime fallback to `LOVABLE_API_KEY`; use configured custom engines or bundled Ollama only.

## Validation
- Update focused routing/provider tests for the three-engine behavior.
- Verify AI engine save, reload, connection-test controls, and feature routing in the live app.
