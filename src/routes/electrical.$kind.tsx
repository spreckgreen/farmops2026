import { createFileRoute, notFound } from "@tanstack/react-router";
import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { EntityManager } from "@/components/electrical/entity-manager";
import { CircuitGroupDerive } from "@/components/electrical/circuit-group-derive";

import { ENTITIES, ENTITY_KINDS } from "@/lib/electrical-entities";
import { Card, CardContent } from "@/components/ui/card";
import type { ElectricalEntityKind } from "@/lib/electrical";

export const Route = createFileRoute("/electrical/$kind")({
  component: EntityListPage,
  validateSearch: (search: Record<string, unknown>) => ({
    edit: typeof search["edit"] === "string" ? (search["edit"] as string) : undefined,
  }),
  errorComponent: ({ error }) => (
    <Card>
      <CardContent className="py-6 text-sm text-destructive">{error.message}</CardContent>
    </Card>
  ),
  notFoundComponent: () => (
    <Card>
      <CardContent className="py-6 text-sm text-muted-foreground">
        Unknown electrical record type.
      </CardContent>
    </Card>
  ),
  beforeLoad: ({ params }) => {
    if (!ENTITY_KINDS.includes(params.kind as ElectricalEntityKind)) throw notFound();
  },
  head: ({ params }) => {
    const def = ENTITIES[params.kind as ElectricalEntityKind];
    const title = `${def?.title ?? "Electrical"} — Bostead Farms`;
    const description = `Field records for electrical ${def?.title.toLowerCase() ?? "infrastructure"} with stable IDs, install status and topology links.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
        { name: "robots", content: "noindex" },
      ],
    };
  },
});

function EntityListPage() {
  const { kind } = Route.useParams();
  return (
    <ElectricalGate>
      <div className="space-y-3">
        {kind === "circuit_group" ? <CircuitGroupDerive /> : null}
        <EntityManager key={kind} kind={kind as ElectricalEntityKind} />
      </div>
    </ElectricalGate>
  );
}

