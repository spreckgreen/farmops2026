# FarmOps Electrical API (v1)

Versioned machine interface to the FarmOps electrical **field/as-built** record.
Built for document generation, QA and external reconciliation (BosteadFarmsBuildDocs).

- Base path: `/api/electrical/v1`
- Contract: `GET /api/electrical/v1/openapi.json` (OpenAPI 3.1, no token required —
  it contains interface description only, no farm data)
- Schema version: `1.0`
- Preview host: `https://project--3262d5a9-40fd-4cf4-a353-9549a732cb96-dev.lovable.app`
- Published host: `https://bostead.lovable.app`

## Authority model

| Concern | System of record |
| --- | --- |
| Engineering / design intent | canonical `PremoFarmElectrical.ods` — **never written by FarmOps or this API** |
| Verified field / as-built state | FarmOps electrical records — read here, and written only through the two scoped endpoints below |

## Excluded by design

1. **SOR administration** — import contracts, mapping repair, adjudication, apply
   gates, entitlements and role administration remain owner-approved UI workflows.
   No endpoint exists for them.
2. **Canonical ODS write-back** — the API never uploads or mutates canonical
   workbook values.
3. **Unrestricted database mutation** — there is no generic `PATCH`/`PUT`/`DELETE`
   and no SQL passthrough. Only two allow-listed write paths exist, both requiring
   explicit per-record approval, both audited in `electrical_change_audit`.

## Authentication

Send a Supabase user access token:

```bash
curl -sS https://bostead.lovable.app/api/electrical/v1 \
  -H "Authorization: Bearer $FARMOPS_ACCESS_TOKEN"
```

- `401` — missing/invalid token.
- `403` — the account lacks the electrical entitlement for the requested mode.
  Reads need the electrical read entitlement (`electrical` or `electrical_readonly`);
  the two write endpoints need a field-write entitlement (`electrical` or the
  field-write electrician add-on).

Row-level security scopes every row to the authenticated user; responses are sent
with `cache-control: private, no-store`.

## Read endpoints (intended use)

| Endpoint | Intended use |
| --- | --- |
| `GET /api/electrical/v1` | Capability discovery: version, resources, endpoints, relationship capabilities, exclusions. Call this first. |
| `GET /api/electrical/v1/snapshot` | One-shot pull of every collection plus QA. Same builder as the FarmOps UI export, so API output matches the UI exactly. |
| `GET /api/electrical/v1/resources/{collection}` | A single collection for a targeted document section (e.g. panel schedule, conduit schedule). |
| `GET /api/electrical/v1/records/{stable_id}` | Every record carrying one stable ID (`PNL-FS-NW`, `FS-082`, `EMT-104`) — per-asset pages, QR/label detail. |
| `GET /api/electrical/v1/qa` | QA findings with error/warning counts, for a QA appendix. QA is reported, never enforced. |
| `GET /api/electrical/v1/documents/bundle` | Section manifest + counts + field ownership + QA + full snapshot in one call — the recommended input for a document generator. |

Collections: `panels`, `loads`, `circuit_groups`, `feeders`, `raceways`,
`raceway_waypoints`, `junction_boxes`, `branch_runs`, `panel_breaker_positions`,
`panel_exits`, `equipment_racks`, `power_assets`, `devices`.

Every record exposes `stable_id` (integration identity) and `uuid` (traceability
only). `null` means *unknown / not established* and is never replaced by a guess.
`field_ownership` tells a generator whether a field is `engineering_design`,
`farmops_as_built`, `imported_legacy` or `unknown`, so design values are never
presented as verified field values.

Example — build a conduit schedule:

```bash
curl -sS "$HOST/api/electrical/v1/resources/raceways" \
  -H "Authorization: Bearer $FARMOPS_ACCESS_TOKEN" | jq '.count, .records[0]'
```

## Write endpoints (scoped, approval-bearing)

### 1. Relationships — record a physical connection

Writes exactly one allow-listed foreign-key column plus its derived legacy mirror
columns (`*_endpoint_ref`, `*_ref`, `*_endpoint_type`). Nothing else on the row is
touched, so engineering values cannot be changed through this path.

Discover what is recordable from `relationship_capabilities` on the index
endpoint, e.g. `raceway.source_panel_uuid → panel` (mirror `source_endpoint_ref`).

Preview (no writes):

```bash
curl -sS -X POST "$HOST/api/electrical/v1/relationships/preview" \
  -H "Authorization: Bearer $FARMOPS_ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d '{"proposals":[
        {"kind":"raceway","stable_id":"EMT-104",
         "relation":"source_panel_uuid","target_stable_id":"PNL-FS-NW"}]}'
```

Response per proposal: `eligible`, `errors[]`, `writable_columns[]`, `before`, `after`.

Apply (each proposal needs `approved: true` and a `reason`):

```bash
curl -sS -X POST "$HOST/api/electrical/v1/relationships/apply" \
  -H "Authorization: Bearer $FARMOPS_ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d '{"proposals":[
        {"kind":"raceway","stable_id":"EMT-104",
         "relation":"source_panel_uuid","target_stable_id":"PNL-FS-NW",
         "approved":true,"reason":"Verified at panel during 2026-09-03 walkaround"}]}'
```

Rejected automatically: unknown kind or relation, missing record, self-reference,
two endpoints in one slot, identical source and destination.
Send `"target_stable_id": null` to clear a link (mirrors are cleared with it).

### 2. Field observations — append what was actually seen

Inserts an append-only row into the field journal. It never edits an engineering
record; correcting a record is a separate, owner-approved UI workflow.

```bash
curl -sS -X POST "$HOST/api/electrical/v1/field-observations/apply" \
  -H "Authorization: Bearer $FARMOPS_ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d '{"observations":[
        {"stable_id":"PNL-FS-NW","field":"install_status",
         "observed_text":"Panel mounted, dead front off, feeders not terminated",
         "interpreted_value":"in_progress","confidence":"high",
         "verification_status":"field_confirmation_required","approved":true}]}'
```

`observed_text` is stored verbatim. `confidence`: `high|medium|low`.
`verification_status`: `verified_as_installed`, `field_confirmation_required`,
`updated_from_field_observation`, `intentionally_mobile`, `not_yet_installed`.
Use `/field-observations/preview` to validate and see the exact row first.

## Verification

- API reads are projections of the same snapshot builder used by
  `/electrical/export` and the FarmOps UI, so collection counts, field values and
  QA findings match the UI and the existing `/api/electrical/snapshot` byte-for-byte
  for the same generation.
- `tests/electrical-api.test.ts` covers the resource registry against the snapshot
  collections, the OpenAPI document, relationship/observation validation, the
  write-column allow-lists and the exclusion notice.

## Compatibility

`/api/electrical/snapshot` (Phase 4.2) remains available and unchanged;
`/api/electrical/v1/snapshot` is the versioned equivalent. Breaking changes get a
new version prefix (`/api/electrical/v2`), never an in-place change to v1.
