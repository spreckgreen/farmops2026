# Electrical Reconciliation Snapshot (Phase 4.2)

Read-only machine interface that lets the external **BosteadFarmsBuildDocs**
document system reconcile FarmOps field/as-built electrical records against the
canonical engineering System of Record.

| Role | Owner |
| --- | --- |
| Engineering System of Record | `PremoFarmElectrical.ods` (external, never written by FarmOps) |
| Field / as-installed authority | FarmOps electrical records |
| Reconciliation + candidate changes | BosteadFarmsBuildDocs (outside FarmOps) |

FarmOps only **emits data**. It never creates, modifies, or synchronizes the ODS
workbook, and this export performs no writes of any kind.

## Access

| Surface | Path |
| --- | --- |
| API | `GET /api/electrical/snapshot` |
| UI download | `/electrical/export` → "Download JSON snapshot" |

The API requires a Supabase user access token and an active `electrical`
entitlement. Row-level security scopes rows to that user.

```bash
curl -s https://bostead.lovable.app/api/electrical/snapshot \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -o farmops-electrical-snapshot.json
```

Responses: `200` snapshot JSON, `401` missing/invalid token, `403` add-on not
enabled. `Cache-Control: private, no-store` — the payload is session-scoped.

## Document shape

```jsonc
{
  "schema_version": "1.0",
  "generated_at": "2026-08-29T16:23:45.123Z",
  "source": "FarmOps",
  "authority": "field-as-built",
  "engineering_system_of_record": "PremoFarmElectrical.ods",
  "counts": { "panels": 7, "raceways": 29, "branch_runs": 0, "...": 0 },
  "field_ownership": { "panels": { "description": "engineering_design", "completion_percent": "farmops_as_built" } },
  "metadata_fields": ["uuid", "stable_id", "created_at", "updated_at"],
  "qa": { "errors": 0, "warnings": 12, "findings": [{ "code": "incomplete_topology", "severity": "warning", "stable_id": "CON-030", "message": "…" }] },
  "panels": [], "loads": [], "circuit_groups": [], "feeders": [],
  "raceways": [], "raceway_waypoints": [],
  "junction_boxes": [], "branch_runs": []
}
```

All eight collections are always present, even when empty — including
`feeders`, added in Phase 4.2 as a normalized panel-to-panel entity rather than
free text on a panel record.

### Identity

Every record carries both:

- `uuid` — FarmOps row id, for traceability only;
- `stable_id` — the integration key (`PNL-FS-CRIT`, `CON-030`, `JB-014`,
  `BR-057`, `FS-097`). Stable IDs are permanent and are never renamed by FarmOps.

Raceway waypoints are ordered attributes of one raceway: they have `uuid`,
`raceway_stable_id`, and `sequence`, and `stable_id` is always `null`. They must
never be reconciled as junction boxes.

### Relationships

Each relationship is exported as an explicit pair — never a formatted display
string:

| FK column | Stable-ID counterpart |
| --- | --- |
| `source_panel_uuid` | `source_panel_stable_id` |
| `dest_jbox_uuid` | `dest_jbox_stable_id` |
| `circuit_group_uuid` | `circuit_group_stable_id` |
| `panel_uuid` | `panel_stable_id` |
| `load_uuid` | `load_stable_id` |

`null` means **unknown / not yet established**. FarmOps never substitutes a
placeholder or a guessed relationship. Legacy ODS design text (for example
`from_label` / `to_label`, `source_endpoint_ref`) is preserved verbatim beside
the relational fields so the reconciler can see both.

### Field ownership

`field_ownership[collection][field]` is one of:

| Value | Meaning |
| --- | --- |
| `engineering_design` | Owned by the ODS engineering SOR; FarmOps displays/imports it |
| `farmops_as_built` | Captured in the field by FarmOps (status, measured length, completion, topology FKs) |
| `imported_legacy` | Read-only text imported from the workbook (Design/Legacy From/To, references) |
| `unknown` | Unclassified |

Reconcilers should treat `engineering_design` mismatches as "FarmOps is stale"
and `farmops_as_built` values as authoritative field data.

### QA

`qa.findings` mirrors `/electrical/qa`. Errors are provably invalid states
(unknown references, FK/reference disagreement, duplicate stable IDs, endpoint
type mismatch). Warnings include `incomplete_topology`, which is expected while
installation is in progress. QA is reported, never enforced: findings do not
block or filter the export.

## Determinism

Identical electrical data produces byte-identical JSON:

- record keys are sorted alphabetically;
- collections are sorted by `stable_id`, then `uuid`;
- waypoints are sorted by `raceway_stable_id`, then `sequence`;
- QA findings are sorted by severity, code, stable ID, message.

Only `generated_at` differs between two exports of unchanged data.

## Boundaries (Phase 4.2)

Implemented: snapshot builder, API endpoint, UI download, ownership metadata,
QA reporting, docs, tests.

Explicitly **not** implemented here: any ODS writer or two-way sync, candidate
change generation, and record mutation from reconciliation results. Those belong
to BosteadFarmsBuildDocs and later phases.

## Implementation

| File | Role |
| --- | --- |
| `src/lib/electrical-snapshot.ts` | Pure deterministic builder (unit-tested, no database) |
| `src/lib/electrical-snapshot.functions.ts` | Authenticated, entitlement-gated collection + server function |
| `src/routes/api/electrical/snapshot.ts` | Bearer-token JSON API route |
| `src/routes/electrical.export.tsx` | In-app preview + download |
| `tests/electrical-snapshot.test.ts` | Schema, identity, relationships, nulls, ownership, determinism |


## SOR status (Phase 4.2)

`/electrical/sor` renders the authority state behind this snapshot, and
`electricalSorStatus` returns the same values as JSON:

- **Current authority** — `canonical_ods` today. FarmOps is a *candidate* SOR
  holding field / as-installed truth; it never writes, replaces or synchronizes
  `BosteadFarmsBuildDocs/documents/VOL-01_Electrical/source/data/PremoFarmElectrical.ods`.
- **Data model version** (`1.1`, bumped when electrical entities change shape)
  and **snapshot schema version** (`1.0`).
- Record counts per collection, last electrical record change, last
  reconciliation snapshot, and unresolved QA errors/warnings.
- **Cutover blockers.** An empty blocker list still does not make FarmOps
  authoritative: Phase 4.5 is an explicit, owner-approved event that also
  requires the archived pre-cutover ODS checksum. Flipping `SOR_AUTHORITY` in
  `src/lib/electrical-sor.ts` is the only way authority changes, and it is not
  automated.
