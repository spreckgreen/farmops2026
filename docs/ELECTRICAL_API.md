# FarmOps Electrical API (v1)

Versioned machine interface to the FarmOps electrical **field/as-built** record.
Built for document generation, QA and external reconciliation (BosteadFarmsBuildDocs).

- Base path: `/api/v1/electrical` (Stage 1, read-only integration)
- Contract: `GET /api/openapi.json` (OpenAPI 3.1, no token required — it contains
  interface description only, no farm data)
- API schema version: `1.1`
- Deprecated alias: `/api/electrical/v1` still answers reads and carries
  `Deprecation: true` plus a `Link: …rel="successor-version"` header. Move callers
  to `/api/v1/electrical`.
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

## Stage 1 status

| Stage | Surface | Status |
| --- | --- | --- |
| 1 | Read endpoints (index, SOR status, snapshot, resources, records, QA, document bundle, audit-batch export) | implemented and activated |
| 2 | `field-observations/preview` + `apply` | defined, **not activated** — answers `503 write_scopes_not_activated` |
| 3 | `relationships/preview` + `apply` | defined, **not activated** — answers `503 write_scopes_not_activated` |
| 4 | Document generation service | not implemented |

Activation of Stage 2/3 is a reviewed source change (`WRITE_SCOPES_ACTIVATED`), not
a config toggle. Call `GET /api/v1/electrical/sor/status` for the live phase state,
canonical baseline hash and snapshot hashes.

## Authentication and scopes

Send a Supabase user access token, or a service-principal key (`farmops_sk_…`)
scoped to the endpoints it may call:

```bash
curl -sS https://bostead.lovable.app/api/v1/electrical \
  -H "Authorization: Bearer $FARMOPS_ACCESS_TOKEN"
```

Named scopes (every endpoint declares exactly one):

| Scope | Grants |
| --- | --- |
| `electrical:read` | snapshot, collections, single records, QA |
| `electrical:sor:read` | system-of-record status and provenance |
| `electrical:documents:read` | document-generation bundles |
| `electrical:audit-batches:read` | field-audit batch metadata and manifest export |
| `electrical:observations:write` | Stage 2 — not activated |
| `electrical:relationships:write` | Stage 3 — not activated |

Every response carries `x-request-id`, the API version, and rate-limit headers.
Limits per principal: 120 read requests/60 s, 30 write requests/60 s; exceeding
returns `429 rate_limited`. Errors always use
`{ "error": { "code", "message", "details?" }, "request_id", "api_version" }`.

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
| `GET /api/v1/electrical` | Capability discovery: version, resources, endpoints, relationship capabilities, exclusions. Call this first. |
| `GET /api/v1/electrical/snapshot` | One-shot pull of every collection plus QA. Same builder as the FarmOps UI export, so API output matches the UI exactly. |
| `GET /api/v1/electrical/resources/{collection}` | A single collection for a targeted document section (e.g. panel schedule, conduit schedule). |
| `GET /api/v1/electrical/records/{stable_id}` | Every record carrying one stable ID (`PNL-FS-NW`, `FS-082`, `EMT-104`) — per-asset pages, QR/label detail. |
| `GET /api/v1/electrical/qa` | QA findings with error/warning counts, for a QA appendix. QA is reported, never enforced. |
| `GET /api/v1/electrical/documents/bundle` | Section manifest + counts + field ownership + QA + full snapshot in one call — the recommended input for a document generator. |

Collections: `panels`, `loads`, `circuit_groups`, `feeders`, `raceways`,
`raceway_waypoints`, `junction_boxes`, `branch_runs`, `panel_breaker_positions`,
`panel_exits`, `equipment_racks`, `power_assets`, `devices`, `switch_banks`,
`switch_devices`, `control_groups`, `control_targets`,
`control_wiring_segments`.

Every record exposes `stable_id` (integration identity) and `uuid` (traceability
only). `null` means *unknown / not established* and is never replaced by a guess.
`field_ownership` tells a generator whether a field is `engineering_design`,
`farmops_as_built`, `imported_legacy` or `unknown`, so design values are never
presented as verified field values.

Example — build a conduit schedule:

```bash
curl -sS "$HOST/api/v1/electrical/resources/raceways" \
  -H "Authorization: Bearer $FARMOPS_ACCESS_TOKEN" | jq '.count, .records[0]'
```

## Field-audit batch export and peer-instance sync (Stage 1)

Two read-only endpoints let a second FarmOps deployment stay in step with an audit
that was already staged or applied elsewhere. Both require
`electrical:audit-batches:read`.

| Endpoint | Returns |
| --- | --- |
| `GET /api/v1/electrical/audit-batches` | batch metadata: `batch_id`, title, scope, building, observed date, `manifest_sha256`, `status`, summary, `approved_at`, `applied_at` |
| `GET /api/v1/electrical/audit-batches/{batch_id}/manifest` | the stored `farmops.electrical.audit-batch.v1` manifest, its stored and recomputed SHA-256, peer status, evidence and the staging contract |

```bash
curl -sS "$HOST/api/v1/electrical/audit-batches/FA-FS-2026-09-03-PM/manifest" \
  -H "Authorization: Bearer $FARMOPS_ACCESS_TOKEN" | jq '.status, .checksum_matches'
```

The export is one-way and carries no approvals. In the FarmOps UI,
**Electrical → Data & migration → Audit batches → "Pull a batch from another
FarmOps instance"** (admin only) reads the peer manifest over https, refuses the
transfer when the checksum does not match, and stages the batch locally as
`validated` preview. Applying it still requires per-item owner approval, the
statement/reason confirmation and the `expected_updated_at` conflict check against
*this* instance's records. Nothing is auto-applied, no engineering value is copied,
and the canonical `PremoFarmElectrical.ods` workbook is never involved.

## Write endpoints (scoped, approval-bearing)

### 1. Relationships — record a physical connection

Writes exactly one allow-listed foreign-key column plus its derived legacy mirror
columns (`*_endpoint_ref`, `*_ref`, `*_endpoint_type`). Nothing else on the row is
touched, so engineering values cannot be changed through this path.

Discover what is recordable from `relationship_capabilities` on the index
endpoint, e.g. `raceway.source_panel_uuid → panel` (mirror `source_endpoint_ref`).

Preview (no writes):

```bash
curl -sS -X POST "$HOST/api/v1/electrical/relationships/preview" \
  -H "Authorization: Bearer $FARMOPS_ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d '{"proposals":[
        {"kind":"raceway","stable_id":"EMT-104",
         "relation":"source_panel_uuid","target_stable_id":"PNL-FS-NW"}]}'
```

Response per proposal: `eligible`, `errors[]`, `writable_columns[]`, `before`, `after`.

Apply (each proposal needs `approved: true` and a `reason`):

```bash
curl -sS -X POST "$HOST/api/v1/electrical/relationships/apply" \
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
curl -sS -X POST "$HOST/api/v1/electrical/field-observations/apply" \
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

- API reads call the same `collectSnapshot` builder that backs `/electrical/export`,
  the FarmOps UI and the existing `/api/electrical/snapshot`, and they only project
  from it — they never re-query or re-derive. For one generation, collection counts,
  field values, `field_ownership` and QA findings are therefore identical across all
  four surfaces.
- `tests/electrical-api.test.ts` proves that projection against a fixture snapshot
  (collections, single-record lookup, QA totals, document bundle) and covers the
  resource registry against `SNAPSHOT_COLLECTIONS`, the OpenAPI document,
  relationship/observation validation, the write-column allow-lists and the
  exclusion notice.
- Unauthenticated smoke check: `GET /api/v1/electrical` and every data path return
  `401` without a bearer token; `GET /api/openapi.json` returns `200`.

## Compatibility

`/api/electrical/snapshot` (Phase 4.2) remains available and unchanged;
`/api/v1/electrical/snapshot` is the versioned equivalent. Breaking changes get a
new version prefix (`/api/electrical/v2`), never an in-place change to v1.

## Lifecycle milestones and panel completeness (schema 1.2)

`install_status` remains a single stored column, but consumers MUST NOT read it as
overall completion. The API and UI share one vocabulary of separately tracked
milestones, any of which may be *not applicable*:

`planned`, `material_ready`, `breaker_installed`, `raceway_installed`,
`conductors_pulled`, `source_termination`, `load_termination`, `tested`,
`energized`, `as_built_verified`, `out_of_service`, `retired`.

- `material_ready` means the materials are physically on hand; it does not mean
  installation started.
- `tested`, `energized` and `as_built_verified` only advance on explicit accepted
  evidence and are never inferred from a neighbouring milestone.

Panel results are always derived from `panel_breaker_positions`,
`circuit_groups`, `branch_runs`, `raceways`, terminations, `loads`, tests and
accepted field observations. No panel percentage is authoritative data.

| Result | Formula |
| --- | --- |
| Capacity utilization | occupied physical positions (poles) ÷ usable physical positions |
| Position documentation coverage | classified positions ÷ usable physical positions |
| Circuit rollout | completed applicable milestones ÷ total applicable milestones, declared in-scope circuits only |
| Load completion | connected identified loads ÷ identified loads |
| Weighted headline (optional) | identical to circuit rollout; never published without the component metrics |

Position classifications: `active`, `planned`, `reserved`, `spare`,
`unavailable`, `unclassified`. Spare and reserved positions never reduce
installation completion; unclassified positions reduce documentation coverage
only. A multi-pole breaker consumes several poles but counts once as a breaker
and normally once as a circuit group.

Holds and conflicts (`disposition = hold | conflict`) are always reported beside
progress and never change a percentage.

### Audit-driven lifecycle changes

An approved `FIELD_AS_BUILT` observation carries its lifecycle consequences in
the same preview and the same atomic transaction: the circuit-group
relationship, direct advance to the installed/complete state (no artificial
material-ready or rough-in steps), shared vs dedicated classification from group
membership, building context from authoritative relationships, and any
explicitly observed grid cell or perimeter post. Testing and energization are
recorded only when explicitly observed. Labels, descriptions and notes are never
rewritten unless the audit proposes them. Every consequence appears as an exact
before/after difference before approval.

Batch `FA-FS-2026-09-03-PM-R2` stays applied and immutable with its original
fingerprint; `FA-FS-2026-09-03-PM-R3-METADATA` reconciles only the omitted
lifecycle, shared/dedicated and explicit location metadata for its 20
field-confirmed loads and recreates no circuit group, breaker position or load
relationship.


## Terminology and code of record (registry electrical.terminology.v1)

Every schema description in this API follows the electrical terminology registry
(`src/lib/electrical-terminology.ts`). NEC-defined objects use NEC wording — panelboard, service
equipment, feeder, branch circuit, OCPD, circuit breaker, outlet, receptacle, receptacle outlet,
junction box, device box, raceway, cable, conductor, grounded conductor, EGC, GEC, disconnecting
means, load, utilization equipment.

FarmOps operational objects are **not** NEC-defined and are named as such in descriptions:
`circuit_group` (logical grouping normally representing one breaker-protected branch circuit),
`branch_run` / run segment (physical routing subordinate to a branch circuit), install stages
(`planned`, `material_ready`, … `complete`, `as_built_verified`), audit batches, `pole_grid` and
`grid_reference`. Install stages are project states, never NEC installation classifications.

Code of record: NEC 2023 (NFPA 70). Jurisdiction and local amendments are recorded with the
registry and may change definitions. FarmOps does not determine code compliance; final
interpretation and installation acceptance remain with the licensed electrician and the authority
having jurisdiction. Field names, enum values and stable IDs are contract surface and are never
renamed because a display term changes.


## Switching and control topology (schema 1.3)

Snapshot schema `1.3` adds five read-only collections. They are read through the
same `electrical:read` scope; **no new write scope is activated**.

| Collection | Contents |
| --- | --- |
| `switch_banks` | `SWB-<site>-###` — the device box or enclosure holding switching devices. FarmOps operational object, never a load. |
| `switch_devices` | `SW-<site>-###` — individual switching devices: single-pole, double-pole, 3-way, 4-way, dimmer, selector. |
| `control_groups` | `CTL-<site>-###` — FarmOps logical grouping of switching devices operating the same target(s). Never a circuit group. |
| `control_targets` | the objects a control group operates: loads, devices, relays, contactors, receptacle outlets. |
| `control_wiring_segments` | physical wiring segments and their conductor function: line supply, switched ungrounded, traveler, grounded conductor, EGC, control conductor, or `unknown_unverified`. |

Rules a consumer can rely on:

- Power distribution and control topology are reported separately. The cable
  between two 3-way switches is a wiring segment of the supplying branch circuit,
  never a second circuit group.
- Conductor function is never inferred from insulation colour, tape or a band.
  A marking is reported in `observed_marking` while `conductor_function` stays
  `unknown_unverified` until the conductor is traced or tested.
- A switch is classified as a disconnecting means only when
  `disconnecting_means_verified` is true.
- Lifecycle components (enclosure, raceway, conductors, device, termination,
  function test, verification) are tracked independently. Raceway or cable
  installation never completes a switch.
- Stable IDs are permanent: moving a bank, reassigning its circuit or changing
  its controlled target never renames `SWB-*`, `SW-*` or `CTL-*`.

Farm Shop batch `FA-FS-2026-09-05-SWITCH-CONTROLS` stages the two observed
enclosures (northeast man door A8 fed from CON-204, southwest man door E1 fed
from CON-107) and the two cables between them. Device counts and types,
conductor functions, controlled targets and functional operation are explicit
holds. `FA-FS-2026-09-03-PM-R2` and `FA-FS-2026-09-03-PM-R3-METADATA` are
unchanged, and peer sync stays preview-only with no writes.
