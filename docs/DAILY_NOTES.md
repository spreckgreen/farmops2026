# Daily notes — how to use them

Everything you type on `/notes/<date>` (e.g. `/notes/2026-08-20`) is plain
markdown. On **Commit to log**, Bostead parses that markdown and turns specific
line shapes into tasks and activity-log entries. Lines that don't match a shape
stay in the note as text — nothing is lost, but nothing is created either.

Two rules to remember:

1. **Nothing happens until you commit.** The live "What 'Commit to log' will do"
   panel under the editor previews every line first.
2. **Line shape matters, not the words.** The parser only looks at how a line
   *starts*.

---

## 1. The syntax cheatsheet

| Line shape | Effect |
| --- | --- |
| `- [ ] Grease the loader pins` | Creates an open task (or reuses an existing one with the same title) |
| `- [x] Grease the loader pins` | Creates/finds the task and marks it **done** |
| `#task/grease-the-loader-pins Fresh grease, 4 pumps` | Adds an activity-log entry to that task, matched by slug |
| `[[Grease the loader pins]] Fresh grease, 4 pumps` | Same, matched by exact task title |
| `!blocker #task/<slug> Waiting on dealer parts` | Entry with type `blocker` |
| `!decision`, `!commit`, `!meeting` | Same, other entry types |
| `Anything else` | Note text only — no task, no log entry |

Metadata can be appended to any task or entry line:

| Token | Example | Effect |
| --- | --- | --- |
| `#project/<tag>` | `#project/boiler-swap` | Attaches to that project |
| `@start:<date> <time>` | `@start:2026-08-21 07:00` | Schedules the task |
| `@progress:<n>%` | `@progress:40%` | Sets percent complete |

### What `#project/<tag>` actually does

If the tag matches an **existing project's slug**, committing also attaches the
task to that project as a **design element** at 10% weight — so it shows up on
`/projects` and counts toward project progress. Adjust the weight there
afterwards. If a project is already weighted to 100%, no element is created (the
tag still sticks).

If the tag matches **no project**, it stays a plain label on the task — useful
for filtering `/tasks`, but nothing appears under `/projects`.

```text
- [ ] Boiler pipe test ends #project/boiler-swap
→ task tagged "boiler-swap"
→ if a project with slug boiler-swap exists: design element created (10%)
```


---

## 2. Creating tasks — the exact checkbox syntax

The required shape is **dash, space, brackets, space, title**:

```text
- [ ] Boiler pipe test ends
  │ │ │
  │ │ └── space after "]" is required
  │ └──── "[ ]" (space inside) for open, "[x]" for done
  └────── "- " dash then space
```

Correct:

```text
- [ ] Boiler pipe test ends
- [x] Grease the loader pins
- [ ] Replace tractor hydraulic filter #project/tractor @start:2026-08-21 07:00
```

Common mistakes (these become plain note text, **not** tasks):

```text
[ ]Boiler pipe test ends      ✗ no "- " and no space after "]"
[ ] Boiler pipe test ends     ✗ missing the leading "- "
* [ ] Boiler pipe test ends   ✗ bullet must be "-", not "*"
- [] Boiler pipe test ends    ✗ brackets need a space: [ ]
- [ ]Boiler pipe test ends    ✗ needs a space after "]"
- [ ]                         ✗ no title, nothing to create
```

The editor highlights each of these in red and the interpretation panel offers a
one-click **Fix syntax → - [ ] …** button that rewrites the line for you.

### A word about prefixes that look like categories

A bare word in front of the title is *not* a category — it becomes part of the
title:

```text
- [ ] Boiler_Test Boiler pipe test ends
→ task title: "Boiler_Test Boiler pipe test ends"
→ slug:       boiler_test-boiler-pipe-test-ends
```

Use a project tag instead:

```text
- [ ] Boiler pipe test ends #project/boiler-test
```

---

## 3. Slugs — referencing a task later

Every task gets a **slug**: a stable, URL-safe ID derived from its title at
creation time.

```text
"Replace tractor hydraulic filter"  →  replace-tractor-hydraulic-filter
```

The slug never changes when you rename the title, so `#task/<slug>` references in
old notes keep working. Copy a task's canonical slug from the chip on its task
page (`/tasks/replace-tractor-hydraulic-filter`), from the interpretation panel,
or with the **Copy link** button.

Logging progress against it on any later day:

```text
#task/replace-tractor-hydraulic-filter Filter swapped, 6.2 qt AW-46 added
!blocker #task/replace-tractor-hydraulic-filter Dealer has no O-ring until Tue
[[Replace tractor hydraulic filter]] Torqued the housing to 25 ft-lb
```

Notes:

- `#task/<slug>` alone, with no text after it, is skipped — add what happened.
- `[[Title]]` must match the current title **exactly**; slugs are safer.
- While typing `#task/`, `#project/`, or `[[`, autocomplete suggests real
  slugs/titles — arrow keys, then Enter.

---

## 4. A realistic day, start to finish

```text
# 2026-08-20

- [ ] Boiler pipe test ends #project/boiler-swap @start:2026-08-21 07:00
- [ ] FarmOps recovery features #project/farmops
- [x] Grease the loader pins

#task/grease-the-loader-pins 4 pumps per zerk, front axle pins were dry
!decision #task/boiler-pipe-test-ends Going with 1" PEX-A instead of copper
!blocker #task/farmops-recovery-features Waiting on the offsite snapshot to verify
[[Boiler pipe test ends]] Pressure held 18 psi overnight @progress:60%

Rain moved in around 3pm, cut the field work short.
```

What committing this does:

| Line | Result |
| --- | --- |
| `- [ ] Boiler pipe test ends …` | New task, slug `boiler-pipe-test-ends`, project `boiler-swap`, scheduled 21 Aug 07:00 |
| `- [ ] FarmOps recovery features …` | New task, slug `farmops-recovery-features` |
| `- [x] Grease the loader pins` | Task created and marked done |
| `#task/grease-the-loader-pins …` | Status entry on that task |
| `!decision #task/boiler-pipe-test-ends …` | `decision` entry (task created earlier in the same note resolves fine) |
| `!blocker #task/farmops-recovery-features …` | `blocker` entry |
| `[[Boiler pipe test ends]] …` | Status entry matched by title, progress set to 60% |
| `Rain moved in …` | Stays as note text only |

---

## 5. Reading the editor feedback

Turn on **Edit markdown** to see the raw editor with inline validation:

| Stripe | Meaning |
| --- | --- |
| Blue | Line will create a task |
| Gray | Line will mark a task done |
| Accent | Line will log an entry onto an existing task |
| Red | Needs attention — malformed checkbox, unknown slug, missing text |
| None | Note text only |

Under the editor, **What 'Commit to log' will do** lists every line with a badge
(`new task`, `existing task`, `mark done`, `blocker entry`, `note only`,
`almost a task`, `unknown task`) plus one-click fixes:

- **Fix syntax → - [ ] …** — repairs a malformed checkbox
- **Create task "…"** — inserts `- [ ] Title` above a line that references a
  task that doesn't exist yet
- **Use #task/\<slug\>** — swaps in the closest matching existing slug
- **Add entry text** — drops the caret at the end of a reference with no text

---

## 6. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| "I typed tasks but nothing appeared on /tasks" | Either you didn't press **Commit to log**, or the lines were malformed — check for red stripes and the `almost a task` badge |
| Entry line shows `unknown task` | The slug doesn't exist. Use the suggested closest slug, or add `- [ ] Title` above it |
| Entry line shows `missing text` | A bare `#task/<slug>` or `[[Title]]` with nothing after it — add what happened |
| `[[Title]]` shows `no title match` | Titles must match exactly; prefer `#task/<slug>` |
| Project tag says "doesn't exist yet" | Create the project first, or accept the tag as a plain label |
| Old notes reference slugs that no longer resolve | Run **Check note references** on `/tasks`, then use the auto-repair panel on `/tasks/refs` |

Related: [`docs/TROUBLESHOOTING.md`](TROUBLESHOOTING.md) for hosting/502 issues.
