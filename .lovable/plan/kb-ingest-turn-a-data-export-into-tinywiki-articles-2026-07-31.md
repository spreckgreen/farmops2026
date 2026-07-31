# KB Ingest: turn a data export into TinyWiki articles

Add a new **Import & summarize** flow to the Procedures pane that takes a data export
(ChatGPT conversations, markdown/text files, CSV/JSON records, PDF/DOCX docs), asks the
AI to write clean KB articles, converts them to TinyWiki markup, and saves them straight
into the Procedures KB with a result report.

## What you get

New page `/procedures/ingest` (reachable from an "Import & summarize" button on the
Procedures pane):

1. **Drop files** — accepts `.zip` / `conversations.json` (ChatGPT export), `.md` / `.txt`,
   `.csv` / `.json`, `.pdf` / `.docx`. Mixed selections are fine.
2. **Preview of detected sources** — a table listing each extracted item with title, source
   type, and character count, plus items skipped (empty, unreadable, over-size).
3. **Choose the run mode**
   - *One article per source item* — each conversation/file/row becomes its own article.
   - *Group by topic* — AI clusters related items and writes fewer consolidated articles.
4. **Run** — reuses the existing `AiProgressStages` indicator (persisted across refresh)
   with Cancel, and is idempotency-guarded like the other heavy AI jobs.
5. **Auto-save + report** — every generated article is written to the KB immediately; the
   result screen lists each article with saved/renamed/failed status and a link that opens
   it in the Procedures viewer. Name collisions get a ` (2)` suffix rather than overwriting.

Article shape produced for each item:

```text
! <Article title>
!! Summary
!! Key points
!! Steps
!! Notes
!! Sources
```

Wiki markup is normalized with the existing tidy formatter, so it renders and round-trips
exactly like a hand-written procedure.

## Guardrails

- Heavy AI feature, so it appears in AI Settings as **KB ingest & summarize (heavy)** and
  is wrapped in the existing feature gate; disabled means the page shows the standard
  "feature disabled" placeholder.
- Uses your existing AI routing (`CUSTOM_AI_*` vault keys / local Ollama, else Lovable AI).
  Long exports are chunked and each article is a separate small call so a small local model
  can keep up; a failed item is reported, it does not abort the run.
- Total ingest size and per-item text are capped, and per-run article count is limited so a
  huge export cannot run away.

## Technical notes

- `src/lib/kb-ingest-parse.ts` (browser, pure): file → `SourceItem[] { id, title, kind, text }`.
  ZIP via `fflate`, ChatGPT `conversations.json` mapping walk, CSV via existing `src/lib/csv.ts`,
  PDF via `pdfjs-dist`, DOCX via `mammoth`. Parsing runs client-side so the Worker runtime
  never touches binary document libraries.
- `src/lib/kb-ingest.functions.ts`: `ingestKbArticles` server fn (`requireSupabaseAuth`),
  input `{ items, mode, runId }`. Uses `createAiProvider()` from `ai-gateway.server`,
  `generateText` per article with a lenient parse (same fallback style as the schedule
  planner), then `markdownToTinyWiki` → `tidyProcedure` → upsert into `procedures` with a
  unique name. Wrapped in `withIdempotency`. Returns `{ articles: [{ name, status, error? }],
  skipped, model, latencyMs }`.
- Group mode adds one preliminary clustering call that returns topic → item-id groups; each
  group is then written as a single article from the concatenated (truncated) sources.
- `src/routes/procedures.ingest.tsx`: wizard UI; `src/routes/procedures.tsx` becomes a
  layout with `<Outlet />` and the existing pane moves to `procedures.index.tsx` (same
  pattern already used for `/maintenance`).
- New feature id `kb.ingest` added to `AI_FEATURES` in `src/lib/ai-features.ts`.
- New deps: `fflate`, `pdfjs-dist`, `mammoth` (client-only imports, lazy-loaded).
