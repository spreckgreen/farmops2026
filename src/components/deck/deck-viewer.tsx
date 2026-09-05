// Shared viewer for the public FarmOps decks (/demo/*).
//
// Owns the fixed 1920x1080 canvas, keyboard model, grid view, print/PDF view
// and the PowerPoint export. Route files stay thin: they validate ?slide,
// ?view and ?download, then hand the values plus a navigate callback down here.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { PromoSlideView } from "@/components/deck/promo-slide";
import { type PromoSlide } from "@/lib/promo-slides";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileDown,
  LayoutGrid,
  Lock,
  Presentation,
  X,
} from "lucide-react";

export type DeckView = "grid" | "print" | undefined;

export interface DeckSearch {
  slide: number;
  view: DeckView;
  download?: true;
}

export interface DeckSlideLink {
  to: string;
  label: string;
  gated?: boolean;
}

export interface DeckSlideLinks {
  heading: string;
  links: DeckSlideLink[];
}

/** Parses ?slide / ?view / ?download for a deck route. */
export function parseDeckSearch(
  search: Record<string, unknown>,
  total: number,
): DeckSearch {
  const raw = Number(search.slide);
  const slide = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), total) : 1;
  const view = search.view === "grid" || search.view === "print" ? search.view : undefined;
  const download =
    search.download === "1" || search.download === 1 || search.download === true
      ? (true as const)
      : undefined;
  return { slide, view, download };
}

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

export function DeckViewer({
  slides,
  deckName,
  fileBase,
  search,
  onNavigate,
  slideLinks,
}: {
  slides: PromoSlide[];
  /** Short name shown in the header, e.g. "FarmOps Maintenance". */
  deckName: string;
  /** Filename stem for the PowerPoint export. */
  fileBase: string;
  search: DeckSearch;
  onNavigate: (next: DeckSearch, replace?: boolean) => void;
  /** Optional per-slide deep links into the real app pages. */
  slideLinks?: Record<number, DeckSlideLinks>;
}) {
  const { slide, view, download } = search;
  const index = slide - 1;
  const total = slides.length;
  const current = slides[index];
  const links = slideLinks?.[slide];
  const autoPrinted = useRef(false);
  const [makingPptx, setMakingPptx] = useState(false);

  const go = useCallback(
    (next: number, nextView: DeckView = view) => {
      const clamped = Math.min(Math.max(next, 1), total);
      onNavigate({ slide: clamped, view: nextView, download: undefined }, true);
    },
    [onNavigate, total, view],
  );

  const savePptx = useCallback(async () => {
    setMakingPptx(true);
    try {
      const { downloadDeckPptx } = await import("@/lib/deck-pptx");
      const name = await downloadDeckPptx({ slides, deckTitle: deckName, fileBase });
      toast.success(`Saved ${name}`);
    } catch {
      toast.error("PowerPoint file could not be created. The PDF handout still works.");
    } finally {
      setMakingPptx(false);
    }
  }, [slides, deckName, fileBase]);

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
        onNavigate({ slide, view: view === "grid" ? undefined : "grid", download: undefined }, true);
      } else if (e.key.toLowerCase() === "p") {
        onNavigate({ slide, view: "print", download: undefined }, true);
      } else if (e.key === "Escape") {
        onNavigate({ slide, view: undefined, download: undefined }, true);
      } else if (e.key === "f" || e.key === "F5") {
        document.documentElement.requestFullscreen?.().catch(() => {});
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onNavigate, slide, view]);

  if (view === "print") {
    return (
      <div className="deck-print-root bg-background">
        <div className="no-print sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-3">
          <Button size="sm" onClick={() => window.print()}>
            <Download className="h-4 w-4 mr-1" /> Download PDF
          </Button>
          <Button size="sm" variant="outline" disabled={makingPptx} onClick={savePptx}>
            <FileDown className="h-4 w-4 mr-1" />
            {makingPptx ? "Building…" : "Download PowerPoint"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onNavigate({ slide, view: undefined, download: undefined })}
          >
            <X className="h-4 w-4 mr-1" /> Close
          </Button>
          <span className="text-xs text-muted-foreground">
            Choose landscape and "Save as PDF" for a {total}-page handout.
          </span>
        </div>
        <div className="flex flex-col items-center">
          {slides.map((s, i) => (
            <PromoSlideView key={i} slide={s} index={i} total={total} />
          ))}
        </div>
      </div>
    );
  }

  if (view === "grid") {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <h1 className="text-xl font-semibold">
            {deckName} — {total} pages
          </h1>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onNavigate({ slide, view: "print", download: true })}
            >
              <Download className="h-4 w-4 mr-1" /> Download PDF
            </Button>
            <Button size="sm" variant="outline" disabled={makingPptx} onClick={savePptx}>
              <FileDown className="h-4 w-4 mr-1" />
              {makingPptx ? "Building…" : "PowerPoint"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onNavigate({ slide, view: undefined, download: undefined })}
            >
              <Presentation className="h-4 w-4 mr-1" /> Back to slide {slide}
            </Button>
          </div>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {slides.map((s, i) => (
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
          <span className="text-sm font-medium truncate">
            {deckName} — {current.title}
          </span>
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
            onClick={() => onNavigate({ slide, view: "grid", download: undefined })}
          >
            <LayoutGrid className="h-4 w-4 mr-1" /> Grid
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onNavigate({ slide, view: "print", download: true })}
          >
            <Download className="h-4 w-4 mr-1" /> PDF
          </Button>
          <Button size="sm" variant="outline" disabled={makingPptx} onClick={savePptx}>
            <FileDown className="h-4 w-4 mr-1" />
            {makingPptx ? "Building…" : "PowerPoint"}
          </Button>
        </div>
      </header>

      <ScaledSlide className="flex-1 w-full min-h-0">
        <PromoSlideView slide={current} index={index} total={total} />
      </ScaledSlide>

      {links && (
        <div className="no-print flex flex-wrap items-center gap-2 border-t border-border bg-card px-4 py-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground mr-1">
            {links.heading}
          </span>
          {links.links.map((l) => (
            <Link
              key={l.to + l.label}
              to={l.to as never}
              className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs hover:border-primary hover:text-primary transition-colors"
            >
              {l.label}
              {l.gated && <Lock className="h-3 w-3 opacity-60" />}
            </Link>
          ))}
          <span className="ml-auto text-[11px] text-muted-foreground">
            <Lock className="inline h-3 w-3 mr-1 align-[-2px]" />
            needs a sign-in with that module granted
          </span>
        </div>
      )}

      <footer className="flex items-center justify-between gap-4 border-t border-border px-4 py-2 text-xs text-muted-foreground">
        <span>← / → or Space to move · G for grid · P for the PDF handout · F for fullscreen</span>
        <Link to="/demo" className="hover:text-primary">
          All presentations
        </Link>
      </footer>
    </div>
  );
}
