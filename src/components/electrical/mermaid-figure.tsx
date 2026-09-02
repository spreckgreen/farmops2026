// Renders a Mermaid source string as an inline SVG figure, with SVG download.
// Mermaid is loaded from the CDN after hydration so it never enters SSR.
import { useEffect, useState } from "react";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const MERMAID_URL = "https://esm.sh/mermaid@11.17.2";

export function MermaidFigure({
  source,
  downloadName,
  className,
}: {
  source: string;
  downloadName?: string;
  className?: string;
}) {
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSvg("");
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
        const out = await mermaid.render(`mf-${Date.now()}`, source);
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
  }, [source]);

  const download = () => {
    const withNs = svg.includes("xmlns:xlink")
      ? svg
      : svg.replace("<svg ", '<svg xmlns:xlink="http://www.w3.org/1999/xlink" ');
    const url = URL.createObjectURL(new Blob([withNs], { type: "image/svg+xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${downloadName ?? "diagram"}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!svg) return <Skeleton className="h-56 w-full" />;

  return (
    <div className={className}>
      <div
        className="overflow-x-auto rounded-md border border-border bg-card p-3"
        // Mermaid output, rendered with securityLevel "strict".
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <Button size="sm" variant="outline" onClick={download} className="mt-2 print:hidden">
        <Download className="mr-1 h-4 w-4" /> SVG
      </Button>
    </div>
  );
}
