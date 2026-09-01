// Local topology figure for a scanned panel label.
//
// Scope note: this renders ONLY the scanned panel's own neighbourhood, built
// from the rows already on the panel sheet. Other panels appear as named
// endpoint boxes with nothing behind them — the farm-wide topology needs an
// approved system-data window.
import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Network } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  buildPanelLocalTopology,
  type PanelLocalTopologyInput,
} from "@/lib/electrical-panel-local-topology";

const MERMAID_URL = "https://esm.sh/mermaid@11.17.2";

export function PanelLocalTopology(props: PanelLocalTopologyInput) {
  const host = useRef<HTMLDivElement | null>(null);
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);

  const topology = useMemo(() => buildPanelLocalTopology(props), [props]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await import(/* @vite-ignore */ MERMAID_URL);
        const mermaid = (mod.default ?? mod) as {
          initialize: (c: Record<string, unknown>) => void;
          render: (id: string, src: string) => Promise<{ svg: string }>;
        };
        mermaid.initialize({
          startOnLoad: false,
          theme: "neutral",
          securityLevel: "strict",
          flowchart: { htmlLabels: false, useMaxWidth: true },
        });
        const out = await mermaid.render(`plt-${Date.now()}`, topology.mermaid);
        if (!cancelled) {
          setSvg(out.svg);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Diagram could not be drawn.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [topology.mermaid]);

  const download = () => {
    const withNs = svg.includes("xmlns:xlink")
      ? svg
      : svg.replace("<svg ", '<svg xmlns:xlink="http://www.w3.org/1999/xlink" ');
    const url = URL.createObjectURL(new Blob([withNs], { type: "image/svg+xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${props.panelId}-local-topology.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="gap-1">
          <Network className="h-3.5 w-3.5" /> {props.panelId} local topology
        </Badge>
        {Object.entries(topology.counts).map(([key, value]) => (
          <Badge key={key} variant="secondary">
            {key.replace(/_/g, " ")}: {value}
          </Badge>
        ))}
        {svg ? (
          <Button size="sm" variant="outline" onClick={download} className="ml-auto print:hidden">
            <Download className="mr-1 h-4 w-4" /> SVG
          </Button>
        ) : null}
      </div>

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : svg ? (
        <div
          ref={host}
          className="overflow-x-auto rounded-md border border-border bg-card p-3"
          // Mermaid output, rendered with securityLevel "strict".
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <Skeleton className="h-56 w-full" />
      )}

      {topology.external_endpoints.length ? (
        <p className="text-xs text-muted-foreground">
          Endpoints shown as boxes only (their own internals are outside this label's scope):{" "}
          {topology.external_endpoints.join(", ")}
        </p>
      ) : null}
    </div>
  );
}
