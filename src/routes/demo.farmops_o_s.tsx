// /demo/farmops_o_s — public, anonymous-access demo for FarmOps O/S: the
// platform layer, the free Procedures module, and the paid modules that already
// run in the application and only need module packaging.
//
// No auth loader, no record reads — static slide content only.
// ?slide=4 keeps a shared link on one page, ?view=grid shows all pages,
// ?view=print stacks them for PDF, and download=1 opens the print dialog.
import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { PromoSlideView } from "@/components/deck/promo-slide";
import { FARMOPS_OS_DEMO_SLIDES } from "@/lib/farmops-os-demo-slides";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  LayoutGrid,
  Presentation,
  X,
} from "lucide-react";

type DemoSearch = { slide: number; view: "grid" | "print" | undefined; download?: true };

const TITLE = "FarmOps O/S — Feature Demo";
const DESCRIPTION =
  "A 15-page walkthrough of FarmOps O/S: the shared platform layer, the free-forever Procedures knowledge base, and the Electrical, Maintenance, Inventory and Food modules already built and awaiting subscription packaging.";

export const Route = createFileRoute("/demo/farmops_o_s")({
  validateSearch: (search: Record<string, unknown>): DemoSearch => {
    const raw = Number(search.slide);
    const slide = Number.isFinite(raw)
      ? Math.min(Math.max(Math.trunc(raw), 1), FARMOPS_OS_DEMO_SLIDES.length)
      : 1;
    const view = search.view === "grid" || search.view === "print" ? search.view : undefined;
    const download =
      search.download === "1" || search.download === 1 || search.download === true
        ? (true as const)
        : undefined;
    return { slide, view, download };
  },
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FarmOpsOsDemoPage,
});

/** Scales the fixed 1920x1080 canvas down to fit a container. */
function ScaledSlide({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      setScale(Math.min(width / 1920, height / 1080));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} className={`relative overflow-hidden ${className}`}>
      <div className="deck-slide-wrapper" style={{ ["--deck-scale" as string]: scale }}>
        {children}
      </div>
    </div>
  );
}

function FarmOpsOsDemoPage() {
  const { slide, view, download } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const index = slide - 1;
  const total = FARMOPS_OS_DEMO_SLIDES.length;
  const current = FARMOPS_OS_DEMO_SLIDES[index];
  const autoPrinted = useRef(false);

  const go = useCallback(
    (next: number, nextView: DemoSearch["view"] = view) => {
      const clamped = Math.min(Math.max(next, 1), total);
      navigate({ search: { slide: clamped, view: nextView, download: undefined }, replace: true });
    },
    [navigate, total, view],
  );

  // Opening ?view=print&download=1 goes straight to the browser's PDF dialog.
  useEffect(() => {
    if (view !== "print" || !download || autoPrinted.current) return;
    autoPrinted.current = true;
    const t = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(t);
  }, [view, download]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        go(slide + 1, undefined);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        go(slide - 1, undefined);
      } else if (e.key.toLowerCase() === "g") {
        navigate({
          search: { slide, view: view === "grid" ? undefined : "grid", download: undefined },
          replace: true,
        });
      } else if (e.key.toLowerCase() === "p") {
        navigate({ search: { slide, view: "print", download: undefined }, replace: true });
      } else if (e.key === "Escape") {
        navigate({ search: { slide, view: undefined, download: undefined }, replace: true });
      } else if (e.key === "f" || e.key === "F5") {
        document.documentElement.requestFullscreen?.().catch(() => {});
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, navigate, slide, view]);

  if (view === "print") {
    return (
      <div className="deck-print-root bg-background">
        <div className="no-print sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-card px-4 py-3">
          <Button size="sm" onClick={() => window.print()}>
            <Download className="h-4 w-4 mr-1" /> Download PDF
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              navigate({ search: { slide, view: undefined, download: undefined } })
            }
          >
            <X className="h-4 w-4 mr-1" /> Close
          </Button>
          <span className="text-xs text-muted-foreground">
            Choose landscape and "Save as PDF" for a {total}-page handout.
          </span>
        </div>
        <div className="flex flex-col items-center">
          {FARMOPS_OS_DEMO_SLIDES.map((s, i) => (
            <PromoSlideView key={i} slide={s} index={i} total={total} />
          ))}
        </div>
      </div>
    );
  }

  if (view === "grid") {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold">FarmOps O/S demo — {total} pages</h1>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate({ search: { slide, view: "print", download: true } })}
            >
              <Download className="h-4 w-4 mr-1" /> Download PDF
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                navigate({ search: { slide, view: undefined, download: undefined } })
              }
            >
              <Presentation className="h-4 w-4 mr-1" /> Back to slide {slide}
            </Button>
          </div>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {FARMOPS_OS_DEMO_SLIDES.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => go(i + 1, undefined)}
              className={`text-left rounded-lg border overflow-hidden hover:border-primary transition-colors ${
                i === index ? "border-primary" : "border-border"
              }`}
            >
              <ScaledSlide className="aspect-video w-full bg-background">
                <PromoSlideView slide={s} index={i} total={total} />
              </ScaledSlide>
              <div className="px-3 py-2 text-xs text-muted-foreground truncate">
                {i + 1}. {s.title}
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="flex items-center justify-between gap-4 border-b border-border px-4 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <Presentation className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-medium truncate">FarmOps O/S — {current.title}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">
            {slide} / {total}
          </span>
          <Button size="sm" variant="ghost" onClick={() => go(slide - 1, undefined)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => go(slide + 1, undefined)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate({ search: { slide, view: "grid", download: undefined } })}
          >
            <LayoutGrid className="h-4 w-4 mr-1" /> Grid
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate({ search: { slide, view: "print", download: true } })}
          >
            <Download className="h-4 w-4 mr-1" /> Download PDF
          </Button>
        </div>
      </header>

      <ScaledSlide className="flex-1 w-full">
        <PromoSlideView slide={current} index={index} total={total} />
      </ScaledSlide>

      <footer className="flex items-center justify-between gap-4 border-t border-border px-4 py-2 text-xs text-muted-foreground">
        <span>← / → or Space to move · G for grid · P for the PDF handout · F for fullscreen</span>
        <Link to="/demo" className="hover:text-primary">
          All presentations
        </Link>
      </footer>
    </div>
  );
}
