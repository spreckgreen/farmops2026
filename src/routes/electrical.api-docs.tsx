// In-app wiki page for the FarmOps Electrical API. Mirrors docs/ELECTRICAL_API.md
// and reads the live contract registry so the page cannot drift from the code.
import { createFileRoute } from "@tanstack/react-router";
import { ElectricalGate } from "@/components/electrical/electrical-gate";
import {
  API_RESOURCES,
  ELECTRICAL_API_BASE,
  ELECTRICAL_API_LEGACY_BASE,
  ELECTRICAL_API_ENDPOINTS,
  ELECTRICAL_API_EXCLUSIONS,
  ELECTRICAL_API_SCHEMA_VERSION,
  ELECTRICAL_API_VERSION,
  OPENAPI_PATH,
  WRITE_SCOPES_ACTIVATED,
  RELATIONSHIP_CAPABILITIES,
  OBSERVATION_CONFIDENCE,
  OBSERVATION_VERIFICATION,
} from "@/lib/electrical-api";
import {
  API_SCOPES,
  API_SCOPE_LIST,
  API_ERROR_CODES,
  API_RATE_LIMITS,
  KNOWN_UNRELIABLE_FIELDS,
  type ApiErrorCode,
} from "@/lib/electrical-api-envelope";
import { ApiPrincipalsCard } from "@/components/electrical/api-principals-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";


export const Route = createFileRoute("/electrical/api-docs")({
  component: ApiDocsPage,
  head: () => ({
    meta: [
      { title: "Electrical API & Integration Docs — Bostead Farms" },
      {
        name: "description",
        content:
          "Versioned read-only FarmOps Electrical API, document-generation endpoints, and the two scoped relationship and field-observation write paths.",
      },
      { property: "og:title", content: "Electrical API & Integration Docs — Bostead Farms" },
      {
        property: "og:description",
        content: "How to use the versioned FarmOps Electrical API for documents and QA.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function ApiDocsPage() {
  return (
    <ElectricalGate>
      <ApiDocs />
    </ElectricalGate>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs leading-relaxed">
      <code>{children}</code>
    </pre>
  );
}

function ApiDocs() {
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            FarmOps Electrical API {ELECTRICAL_API_VERSION}
            <Badge variant="secondary" className="ml-2">
              schema {ELECTRICAL_API_SCHEMA_VERSION}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Machine interface to the electrical field/as-built record, for document
            generation, QA and external reconciliation. Base path{" "}
            <code className="text-foreground">{ELECTRICAL_API_BASE}</code>. The published
            contract is at{" "}
            <a
              className="text-foreground underline"
              href={OPENAPI_PATH}
              target="_blank"
              rel="noreferrer"
            >
              {OPENAPI_PATH}
            </a>
            . <code className="text-foreground">{ELECTRICAL_API_LEGACY_BASE}</code> still
            answers as a deprecated alias and returns{" "}
            <code className="text-foreground">Deprecation</code> and{" "}
            <code className="text-foreground">Link</code> headers.
          </p>
          <p>
            Authority: the canonical PremoFarmElectrical.ods workbook remains the
            engineering system of record and is never written by FarmOps or this API.
            FarmOps owns verified field/as-built state.
          </p>
          <Code>{`curl -sS "$HOST${ELECTRICAL_API_BASE}" \\
  -H "Authorization: Bearer $FARMOPS_SERVICE_KEY" \\
  -H "x-request-id: doc-run-2026-06-08-01"`}</Code>
          <p>
            Callers authenticate as a signed-in user or as a scoped service principal.
            Every response carries <code className="text-foreground">request_id</code>, and
            snapshot responses carry <code className="text-foreground">snapshot_id</code>,{" "}
            <code className="text-foreground">api_version</code>,{" "}
            <code className="text-foreground">data_updated_through</code>, the canonical ODS
            SHA-256, the FarmOps snapshot hash, a deterministic{" "}
            <code className="text-foreground">content_hash</code> and a full source
            manifest, so two identical requests hash identically.
          </p>
          <p>
            Phase status: Phase 1 read-only integration is the active surface. Write scopes
            are{" "}
            <Badge variant={WRITE_SCOPES_ACTIVATED ? "secondary" : "outline"}>
              {WRITE_SCOPES_ACTIVATED ? "activated" : "not activated"}
            </Badge>{" "}
            — the Phase 2/3 relationship and field-observation endpoints answer{" "}
            <code className="text-foreground">503 write_scopes_not_activated</code> until
            Phase 1 is accepted and their safety protocol is completed.
          </p>
        </CardContent>
      </Card>

      <ApiPrincipalsCard />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Scopes, errors and rate limits</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3">Scope</th>
                  <th className="py-1">Grants</th>
                </tr>
              </thead>
              <tbody>
                {API_SCOPE_LIST.map((s) => (
                  <tr key={s} className="border-t border-border">
                    <td className="py-1 pr-3 font-mono">{s}</td>
                    <td className="py-1">{API_SCOPES[s]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3">Error code</th>
                  <th className="py-1">HTTP</th>
                </tr>
              </thead>
              <tbody>
                {(Object.keys(API_ERROR_CODES) as ApiErrorCode[]).map((code) => (
                  <tr key={code} className="border-t border-border">
                    <td className="py-1 pr-3 font-mono">{code}</td>
                    <td className="py-1">{API_ERROR_CODES[code]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-xs text-muted-foreground">
            Rate limits per principal:{" "}
            {API_RATE_LIMITS.map(
              (r) => `${r.bucket} ${r.requests}/${r.window_seconds}s`,
            ).join(" · ")}
            .
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Known-unreliable fields</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {KNOWN_UNRELIABLE_FIELDS.map((f) => (
            <div key={f.field}>
              <div className="font-mono text-xs">
                {f.field} — {f.collections.join(", ")}
              </div>
              <div className="text-muted-foreground">{f.reason}</div>
              <div className="text-xs text-muted-foreground">{f.guidance}</div>
            </div>
          ))}

          <p className="text-xs text-muted-foreground">
            These are surfaced as <code>warnings[]</code> on every snapshot response, so a
            generator can annotate rather than silently publish them.
          </p>
        </CardContent>
      </Card>


      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Excluded by design</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {ELECTRICAL_API_EXCLUSIONS.map((e) => (
            <div key={e.id}>
              <div className="font-medium">{e.title}</div>
              <div className="text-muted-foreground">{e.detail}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Endpoints and intended use</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">Method</th>
                <th className="py-1 pr-3">Path</th>
                <th className="py-1 pr-3">Access</th>
                <th className="py-1 pr-3">Writes</th>
                <th className="py-1">Intended use</th>
              </tr>
            </thead>
            <tbody>
              {ELECTRICAL_API_ENDPOINTS.map((e) => (
                <tr key={`${e.method} ${e.path}`} className="border-t border-border">
                  <td className="py-1 pr-3">{e.method}</td>
                  <td className="py-1 pr-3 font-mono">{e.path}</td>
                  <td className="py-1 pr-3">{e.access}</td>
                  <td className="py-1 pr-3">{e.writes ? "yes" : "no"}</td>
                  <td className="py-1">{e.intended_use}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Collections for document sections</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">Collection</th>
                <th className="py-1 pr-3">What it is</th>
                <th className="py-1">Intended use</th>
              </tr>
            </thead>
            <tbody>
              {API_RESOURCES.map((r) => (
                <tr key={r.name} className="border-t border-border">
                  <td className="py-1 pr-3 font-mono">{r.name}</td>
                  <td className="py-1 pr-3">{r.purpose}</td>
                  <td className="py-1">{r.intended_use}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="pt-2 text-xs text-muted-foreground">
            Each record carries <code>stable_id</code> (integration identity) and{" "}
            <code>uuid</code> (traceability only). <code>null</code> means unknown / not
            established and is never replaced by a guess. <code>field_ownership</code>
            marks each field as engineering design, FarmOps as-built, imported legacy or
            unknown so a generator never presents a design value as verified.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Relationships — preview then apply</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Writes exactly one allow-listed foreign-key column plus its derived mirror
            columns. Nothing else on the row changes, so engineering values cannot be
            altered through this path. Each proposal needs{" "}
            <code className="text-foreground">approved: true</code> and a{" "}
            <code className="text-foreground">reason</code>, and every write is audited.
          </p>
          <Code>{`curl -sS -X POST "$HOST${ELECTRICAL_API_BASE}/relationships/preview" \\
  -H "Authorization: Bearer $FARMOPS_ACCESS_TOKEN" \\
  -H "content-type: application/json" \\
  -d '{"proposals":[{"kind":"raceway","stable_id":"EMT-104",
        "relation":"source_panel_uuid","target_stable_id":"PNL-FS-NW"}]}'`}</Code>
          <Code>{`curl -sS -X POST "$HOST${ELECTRICAL_API_BASE}/relationships/apply" \\
  -H "Authorization: Bearer $FARMOPS_ACCESS_TOKEN" \\
  -H "content-type: application/json" \\
  -d '{"proposals":[{"kind":"raceway","stable_id":"EMT-104",
        "relation":"source_panel_uuid","target_stable_id":"PNL-FS-NW",
        "approved":true,"reason":"Verified at panel during walkaround"}]}'`}</Code>
          <p>
            Send <code className="text-foreground">"target_stable_id": null</code> to clear
            a link; its mirror columns are cleared with it. Self-references, two endpoints
            in one slot and identical source/destination are rejected.
          </p>
          <div className="max-h-60 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3">Kind</th>
                  <th className="py-1 pr-3">relation</th>
                  <th className="py-1 pr-3">Target</th>
                  <th className="py-1">Mirror column</th>
                </tr>
              </thead>
              <tbody>
                {RELATIONSHIP_CAPABILITIES.map((c) => (
                  <tr key={`${c.kind}.${c.relation}`} className="border-t border-border">
                    <td className="py-1 pr-3">{c.kind}</td>
                    <td className="py-1 pr-3 font-mono">{c.relation}</td>
                    <td className="py-1 pr-3">{c.target_kind}</td>
                    <td className="py-1 font-mono">{c.mirror_column}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Field observations — append only</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Records what was actually seen in the field as a journal row. It never edits an
            engineering record: correcting a record stays an owner-approved workflow in the
            UI. <code className="text-foreground">observed_text</code> is stored verbatim.
          </p>
          <Code>{`curl -sS -X POST "$HOST${ELECTRICAL_API_BASE}/field-observations/apply" \\
  -H "Authorization: Bearer $FARMOPS_ACCESS_TOKEN" \\
  -H "content-type: application/json" \\
  -d '{"observations":[{"stable_id":"PNL-FS-NW","field":"install_status",
        "observed_text":"Panel mounted, feeders not terminated",
        "interpreted_value":"in_progress","confidence":"high",
        "verification_status":"field_confirmation_required","approved":true}]}'`}</Code>
          <p>
            confidence: {OBSERVATION_CONFIDENCE.join(" · ")} — verification_status:{" "}
            {OBSERVATION_VERIFICATION.join(" · ")}.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
