// Renders one FarmOps promotional slide on the fixed 1920x1080 canvas.
// Layouts: title, statement, card grid, screenshot claim, add-on line-up,
// pricing table, and closing call to action.
import { type PromoSlide } from "@/lib/promo-slides";

function Chrome({ index, total }: { index: number; total: number }) {
  return (
    <div className="absolute bottom-10 left-20 right-20 flex items-center justify-between text-muted-foreground slide-footer">
      <span>FarmOps · Operations platform for working properties</span>
      <span className="slide-page">
        {index + 1} / {total}
      </span>
    </div>
  );
}

function ScreenFrame({ src, alt, height }: { src: string; alt: string; height: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-glow">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-background/60">
        <span className="h-3.5 w-3.5 rounded-full bg-destructive/70" />
        <span className="h-3.5 w-3.5 rounded-full bg-primary/70" />
        <span className="h-3.5 w-3.5 rounded-full bg-muted" />
      </div>
      <img src={src} alt={alt} className={`block w-full ${height} object-cover object-top`} />
    </div>
  );
}

export function PromoSlideView({
  slide,
  index,
  total,
}: {
  slide: PromoSlide;
  index: number;
  total: number;
}) {
  if (slide.kind === "title") {
    return (
      <div className="slide-content bg-gradient-card text-foreground flex flex-col justify-center px-32">
        <p className="slide-kicker text-primary mb-8">{slide.kicker}</p>
        <h1 className="slide-title-lg text-gradient-amber font-semibold mb-10">{slide.title}</h1>
        <p className="slide-subtitle text-muted-foreground max-w-[1350px]">{slide.subtitle}</p>
        <p className="slide-body-lg text-primary mt-16">{slide.footer}</p>
        <Chrome index={index} total={total} />
      </div>
    );
  }

  if (slide.kind === "statement") {
    return (
      <div className="slide-content bg-background text-foreground flex flex-col px-32 pt-24">
        <p className="slide-kicker text-primary mb-6">{slide.kicker}</p>
        <h2 className="slide-title font-semibold mb-8">{slide.title}</h2>
        <p className="slide-body-lg text-muted-foreground max-w-[1450px] mb-12">{slide.lead}</p>
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

  if (slide.kind === "cards") {
    const cols = slide.cards.length > 4 ? "grid-cols-3" : slide.cards.length === 3 ? "grid-cols-3" : "grid-cols-2";
    return (
      <div className="slide-content bg-background text-foreground flex flex-col px-24 pt-20">
        <p className="slide-kicker text-primary mb-5">{slide.kicker}</p>
        <h2 className="slide-title font-semibold mb-12">{slide.title}</h2>
        <div className={`grid ${cols} gap-8`}>
          {slide.cards.map((c) => (
            <div
              key={c.heading}
              className="rounded-2xl border border-border bg-card px-8 py-7 min-h-[240px]"
            >
              <p className="slide-kicker text-primary mb-4">{c.label}</p>
              <p className="slide-body-lg font-semibold mb-4 leading-tight">{c.heading}</p>
              <p className="slide-caption text-muted-foreground leading-snug">{c.body}</p>
            </div>
          ))}
        </div>
        {slide.note ? (
          <p className="slide-body text-primary mt-auto mb-28 max-w-[1500px]">{slide.note}</p>
        ) : null}
        <Chrome index={index} total={total} />
      </div>
    );
  }

  if (slide.kind === "shot") {
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
          <div className="w-[620px] shrink-0">
            <p className="slide-body text-foreground/90 mb-8 leading-snug">{slide.claim}</p>
            <ul className="space-y-5">
              {slide.points.map((p) => (
                <li key={p} className="flex gap-5 items-start">
                  <span className="mt-3 h-3 w-3 shrink-0 rounded-full bg-primary" />
                  <span className="slide-caption text-muted-foreground leading-snug">{p}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex-1">
            <ScreenFrame
              src={slide.image}
              alt={`${slide.title} — ${slide.route} screen`}
              height="h-[640px]"
            />
          </div>
        </div>
        <Chrome index={index} total={total} />
      </div>
    );
  }

  if (slide.kind === "addons") {
    return (
      <div className="slide-content bg-background text-foreground flex flex-col px-24 pt-20">
        <p className="slide-kicker text-primary mb-5">{slide.kicker}</p>
        <h2 className="slide-title font-semibold mb-10">{slide.title}</h2>
        <div className="space-y-5">
          {slide.items.map((a) => (
            <div
              key={a.name}
              className="flex items-start gap-8 rounded-2xl border border-border bg-card px-8 py-6"
            >
              <div className="w-[440px] shrink-0">
                <p className="slide-body font-semibold leading-tight">{a.name}</p>
                <div className="mt-3 flex gap-3">
                  <span
                    className={`slide-chrome rounded-full px-5 py-2 border ${
                      a.tier === "free"
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border bg-background text-muted-foreground"
                    }`}
                  >
                    {a.tier === "free" ? "Free forever" : "Paid add-on"}
                  </span>
                  <span className="slide-chrome rounded-full border border-border bg-background px-5 py-2 text-muted-foreground">
                    {a.status}
                  </span>
                </div>
              </div>
              <p className="slide-caption text-muted-foreground leading-snug">{a.summary}</p>
            </div>
          ))}
        </div>
        <p className="slide-body text-primary mt-auto mb-28 max-w-[1500px]">{slide.note}</p>
        <Chrome index={index} total={total} />
      </div>
    );
  }

  if (slide.kind === "pricing") {
    return (
      <div className="slide-content bg-background text-foreground flex flex-col px-24 pt-20">
        <p className="slide-kicker text-primary mb-5">{slide.kicker}</p>
        <h2 className="slide-title font-semibold mb-10">{slide.title}</h2>
        <div className="rounded-2xl border border-border overflow-hidden">
          <div className="grid grid-cols-[520px_460px_180px_1fr] bg-card slide-chrome text-muted-foreground uppercase tracking-wider">
            <span className="px-7 py-4">Edition</span>
            <span className="px-7 py-4">Price anchor</span>
            <span className="px-7 py-4">Seats</span>
            <span className="px-7 py-4">Add-ons</span>
          </div>
          {slide.rows.map((r, i) => (
            <div
              key={r.name}
              className={`grid grid-cols-[520px_460px_180px_1fr] items-start ${
                i % 2 === 0 ? "bg-background" : "bg-card/50"
              }`}
            >
              <span className="px-7 py-5 slide-caption font-semibold">{r.name}</span>
              <span className="px-7 py-5 slide-caption text-primary leading-snug">{r.price}</span>
              <span className="px-7 py-5 slide-caption text-muted-foreground">{r.seats}</span>
              <span className="px-7 py-5 slide-caption text-muted-foreground leading-snug">
                {r.addons}
              </span>
            </div>
          ))}
        </div>
        <p className="slide-caption text-muted-foreground mt-auto mb-28 max-w-[1500px]">
          {slide.note}
        </p>
        <Chrome index={index} total={total} />
      </div>
    );
  }

  return (
    <div className="slide-content bg-gradient-card text-foreground flex flex-col justify-center px-32">
      <p className="slide-kicker text-primary mb-8">{slide.kicker}</p>
      <h2 className="slide-title-lg text-gradient-amber font-semibold mb-10">{slide.title}</h2>
      <p className="slide-subtitle text-muted-foreground max-w-[1350px] mb-14">{slide.lead}</p>
      <ul className="space-y-6 max-w-[1450px]">
        {slide.actions.map((a) => (
          <li key={a} className="flex gap-5 items-start">
            <span className="mt-4 h-3 w-3 shrink-0 rounded-full bg-primary" />
            <span className="slide-body text-foreground/90">{a}</span>
          </li>
        ))}
      </ul>
      <p className="slide-body-lg text-primary mt-16 font-mono">{slide.footer}</p>
      <Chrome index={index} total={total} />
    </div>
  );
}
