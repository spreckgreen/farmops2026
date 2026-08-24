// Renders one FarmOps deck slide on the fixed 1920x1080 canvas.
// Layouts: title, section divider, text list, and screenshot walkthrough.
import { type Slide } from "@/lib/deck-slides";

function Chrome({ index, total }: { index: number; total: number }) {
  return (
    <div className="absolute bottom-10 left-20 right-20 flex items-center justify-between text-muted-foreground slide-footer">
      <span>FarmOps · Homestead operations handbook</span>
      <span className="slide-page">
        {index + 1} / {total}
      </span>
    </div>
  );
}

function ScreenFrame({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-glow">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-background/60">
        <span className="h-3.5 w-3.5 rounded-full bg-destructive/70" />
        <span className="h-3.5 w-3.5 rounded-full bg-primary/70" />
        <span className="h-3.5 w-3.5 rounded-full bg-muted" />
      </div>
      <img src={src} alt={alt} className="block w-full h-[640px] object-cover object-top" />
    </div>
  );
}

export function DeckSlide({
  slide,
  index,
  total,
}: {
  slide: Slide;
  index: number;
  total: number;
}) {
  if (slide.kind === "title") {
    return (
      <div className="slide-content bg-background text-foreground flex flex-col justify-center px-32">
        <p className="slide-kicker text-primary mb-8">{slide.kicker}</p>
        <h1 className="slide-title-lg text-gradient-amber font-semibold mb-10">{slide.title}</h1>
        <p className="slide-subtitle text-muted-foreground max-w-[1300px]">{slide.subtitle}</p>
        <p className="slide-body-lg text-foreground/80 mt-16 max-w-[1200px]">{slide.footer}</p>
        <Chrome index={index} total={total} />
      </div>
    );
  }

  if (slide.kind === "section") {
    return (
      <div className="slide-content bg-gradient-card text-foreground flex flex-col justify-center px-32">
        <p className="slide-title-lg text-primary/40 font-semibold mb-4">{slide.number}</p>
        <h2 className="slide-title font-semibold mb-8">{slide.title}</h2>
        <p className="slide-subtitle text-muted-foreground max-w-[1300px] mb-14">
          {slide.subtitle}
        </p>
        <div className="flex flex-wrap gap-4 max-w-[1500px]">
          {slide.covers.map((c) => (
            <span
              key={c}
              className="slide-badge rounded-full border border-primary/40 bg-primary/10 text-primary px-6 py-3"
            >
              {c}
            </span>
          ))}
        </div>
        <Chrome index={index} total={total} />
      </div>
    );
  }

  if (slide.kind === "text") {
    return (
      <div className="slide-content bg-background text-foreground flex flex-col px-32 pt-24">
        <p className="slide-kicker text-primary mb-6">{slide.kicker}</p>
        <h2 className="slide-title font-semibold mb-12">{slide.title}</h2>
        <ul className="space-y-6 max-w-[1500px]">
          {slide.bullets.map((b, i) => (
            <li key={b} className="flex gap-6 items-start">
              <span className="slide-caption mt-2 h-11 w-11 shrink-0 rounded-full bg-primary/15 text-primary flex items-center justify-center">
                {i + 1}
              </span>
              <span className="slide-body text-foreground/90">{b}</span>
            </li>
          ))}
        </ul>
        {slide.note ? (
          <p className="slide-body-lg text-primary mt-auto mb-28 max-w-[1400px]">{slide.note}</p>
        ) : null}
        <Chrome index={index} total={total} />
      </div>
    );
  }

  return (
    <div className="slide-content bg-background text-foreground flex flex-col px-20 pt-16">
      <div className="flex items-end justify-between mb-8">
        <div>
          <p className="slide-kicker text-primary mb-4">{slide.kicker}</p>
          <h2 className="slide-title font-semibold">{slide.title}</h2>
        </div>
        <span className="slide-badge rounded-full border border-border bg-card text-muted-foreground px-6 py-3 font-mono">
          {slide.route}
        </span>
      </div>

      <div className="flex gap-12 items-start">
        <ul className="w-[620px] shrink-0 space-y-5">
          {slide.steps.map((s, i) => (
            <li key={s} className="flex gap-5 items-start">
              <span className="slide-caption mt-1 h-10 w-10 shrink-0 rounded-full bg-primary/15 text-primary flex items-center justify-center">
                {i + 1}
              </span>
              <span className="slide-caption text-foreground/90 leading-snug">{s}</span>
            </li>
          ))}
          {slide.tip ? (
            <li className="rounded-xl border-l-4 border-primary bg-card px-6 py-5">
              <span className="slide-caption text-primary">{slide.tip}</span>
            </li>
          ) : null}
        </ul>
        <div className="flex-1">
          <ScreenFrame src={slide.image} alt={`${slide.title} — ${slide.route} screen`} />
        </div>
      </div>
      <Chrome index={index} total={total} />
    </div>
  );
}
