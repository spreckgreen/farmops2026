# Continuous Raceway Preview Defect Correction

## Goal
Make the QA orphan finding and correction preview use one deterministic candidate-resolution path, expose the rejection reason for every orphan-path junction box, and prove the exact `CON-104` production topology without writing any records.

## Implementation

1. **Create one shared pure candidate resolver**
   - Add a pure resolver in the continuous-raceway topology module that receives a junction box plus the visible raceway rows.
   - Return the full decision record: junction-box ID/UUID, extracted path and encoded position, current raceway UUID/sequence, matching raceway IDs/UUIDs, endpoint evidence, status, and explicit rejection reason.
   - Treat `CON-104.dest_jbox_uuid = JB-104-01` as supporting evidence, not a conflict or a requirement for downstream boxes.
   - Require one unique matching continuous raceway for an automatic proposal; retain explicit ambiguous/no-match/conflict results instead of dropping rows.

2. **Unify QA and preview matching**
   - Replace the independent `orphan_path_topology` path lookup with the shared resolver.
   - Build `planJboxRacewayPopulation` from the same resolver result so any J-box reported by QA as an actionable orphan is also represented in preview with either a proposal or a concrete rejection reason.
   - Preserve existing protections: no overwrite of an existing different parent, no occupied sequence collision, no ID rename, and no invented raceway records.

3. **Return and display complete diagnostics**
   - Extend the preview response with one diagnostic row per orphan-path J-box:
     `jbox_id | extracted_path | raceway_uuid | sequence | matching_raceways | status | rejection_reason`.
   - Ensure the server handler does not filter these rows before returning them.
   - Render the diagnostic table in the Continuous raceway topology QA section even when there are zero eligible proposals, and include the same fields in the CSV export.
   - Keep Preview read-only; do not invoke Apply or perform any production write during diagnosis or verification.

4. **Add exact production-fixture regressions**
   - Model `PNL-FS-NW → CON-104`, with `CON-104.dest_jbox_uuid → JB-104-01`; all three J-box parent/sequence fields null; four branches from `JB-104-02`; one branch from `JB-104-03`.
   - Assert QA classifies all three as actionable orphan-path records through the shared resolver.
   - Assert preview returns exactly:
     - `JB-104-01 → CON-104 / 1`
     - `JB-104-02 → CON-104 / 2`
     - `JB-104-03 → CON-104 / 3`
   - In a separate linked-state renderer assertion, verify the continuous edges `CON-104 → JB-104-01 → JB-104-02 → JB-104-03` remain present while all five branches attach to their proper intermediate boxes.

5. **Verify without changing data**
   - Run the focused continuous-raceway tests, then the relevant electrical integrity/diagram tests.
   - Check the application build diagnostics after edits.
   - Report the exact condition found and corrected, plus the diagnostic output shape; do not claim production records were populated.

## Constraints
- No database or canonical ODS writes.
- No stable-ID changes, new `CON` records, branch source-panel population, Boolean reconciliation changes, or Phase 4.5 work.
- Existing Apply behavior remains explicitly user-triggered and is not exercised as part of this correction.
