// /deck — the FarmOps instructional deck.
// Slides author at 1920x1080 and scale to fit any viewport. The current slide
// lives in the URL (?slide=7) so a refresh or a shared link lands in the same
// place; ?view=grid shows all 30 pages and ?view=print stacks them for PDF.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { DeckSlide } from "@/components/deck/deck-slide";
import { SLIDES } from "@/lib/deck-slides";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Printer,
  Presentation,
  X,
} from "lucide-react";

type DeckSearch = { slide: number; view: "grid" | "print" | undefined };

export const Route = createFileRoute("/deck")({
  validateSearch: (search: Record<string, unknown>): DeckSearch => {
    const raw = Number(search.slide);
    const slide = Number.isFinite(raw)
      ? Math.min(Math.max(Math.trunc(raw), 1), SLIDES.length)
      : 1;
    const view = search.view === "grid" || search.view === "print" ? search.view : undefined;
    return { slide, view };
  },
  head: () => ({
    meta: [
      { title: "FarmOps Deck — Homestead Operations Handbook" },
      {
        name: "description",
        content:
          "A 30-page guided tour of FarmOps for homesteaders: daily tasks, inventory and kits, maintenance plans, food storage, and backups — with real screens.",
      },
      { property: "og:title", content: "FarmOps Deck — Homestead Operations Handbook" },
      {
        property: "og:description",
        content:
          "Thirty instructional pages showing how to run a homestead in FarmOps, illustrated with real application screens.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DeckPage,
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

function DeckPage() {
  const { slide, view } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const index = slide - 1;
  const total = SLIDES.length;
  const current = SLIDES[index];

  const go = useCallback(
    (next: number, nextView: DeckSearch["view"] = view) => {
      const clamped = Math.min(Math.max(next, 1), total);
      navigate({ search: { slide: clamped, view: nextView }, replace: true });
    },
    [navigate, total, view],
  );

  const heading = useMemo(
    () => (current.kind === "title" ? current.title : current.title),
    [current],
  );

  useEffect(() => {
    document.title = `${slide}/${total} — ${heading} · FarmOps Deck`;
  }, [slide, total, heading]);

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
        navigate({ search: { slide, view: view === "grid" ? undefined : "grid" }, replace: true });
      } else if (e.key.toLowerCase() === "p") {
        navigate({ search: { slide, view: "print" }, replace: true });
      } else if (e.key === "Escape") {
        navigate({ search: { slide, view: undefined }, replace: true });
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
            <Printer className="h-4 w-4 mr-1" /> Print / Save as PDF
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => navigate({ search: { slide, view: undefined } })}
          >
            <X className="h-4 w-4 mr-1" /> Close
          </Button>
          <span className="text-xs text-muted-foreground">
            Choose landscape and "Save as PDF" for a {total}-page handout.
          </span>
        </div>
        <div className="flex flex-col items-center">
          {SLIDES.map((s, i) => (
            <DeckSlide key={i} slide={s} index={i} total={total} />
          ))}
        </div>
      </div>
    );
  }

  if (view === "grid") {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold">FarmOps deck — {total} pages</h1>
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate({ search: { slide, view: undefined } })}
          >
            <Presentation className="h-4 w-4 mr-1" /> Back to slide {slide}
          </Button>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {SLIDES.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => go(i + 1, undefined)}
              className={`text-left rounded-lg border overflow-hidden hover:border-primary transition-colors ${
                i === index ? "border-primary" : "border-border"
              }`}
            >
              <ScaledSlide className="aspect-video w-full bg-background">
                <DeckSlide slide={s} index={i} total={total} />
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
          <span className="text-sm font-medium truncate">FarmOps — {heading}</span>
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
            onClick={() => navigate({ search: { slide, view: "grid" } })}
          >
            <LayoutGrid className="h-4 w-4 mr-1" /> Grid
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate({ search: { slide, view: "print" } })}
          >
            <Printer className="h-4 w-4 mr-1" /> Print
          </Button>
        </div>
      </header>

      <ScaledSlide className="flex-1 w-full">
        <DeckSlide slide={current} index={index} total={total} />
      </ScaledSlide>

      <footer className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
        ← / → or Space to move · G for grid · P for print · F for fullscreen
      </footer>
    </div>
  );
}
