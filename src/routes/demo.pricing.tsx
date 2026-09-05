// /demo/pricing — public, anonymous pricing calculator for the FarmOps O/S
// handout. Pure arithmetic over design price anchors; reads no records and
// charges nothing.
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, ArrowLeft, Info } from "lucide-react";
import {
  PRICED_MODULES,
  PRICING_DISCLAIMER,
  editionAnchorText,
  quoteAll,
  type Billing,
  type CalculatorInput,
  type Deployment,
} from "@/lib/farmops-pricing";

const TITLE = "FarmOps O/S Pricing Calculator — Modules, Seats and Sites";
const DESCRIPTION =
  "Price a FarmOps O/S install: pick hosted or self-hosted, choose the Electrical, Maintenance, Inventory and Food modules you need, set people and sites, and compare first-year and ongoing cost against every edition anchor.";

export const Route = createFileRoute("/demo/pricing")({
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
  component: PricingCalculatorPage,
});

const money = (n: number) => `$${n.toLocaleString("en-US")}`;

function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-2 text-sm transition-colors ${
        active
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border text-muted-foreground hover:border-primary/50"
      }`}
    >
      {children}
    </button>
  );
}

function Stepper({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  onChange: (n: number) => void;
}) {
  return (
    <div>
      <p className="text-sm font-medium mb-2">{label}</p>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => onChange(Math.max(min, value - 1))}>
          −
        </Button>
        <span className="w-12 text-center tabular-nums text-lg">{value}</span>
        <Button size="sm" variant="outline" onClick={() => onChange(value + 1)}>
          +
        </Button>
      </div>
    </div>
  );
}

function PricingCalculatorPage() {
  const [deployment, setDeployment] = useState<Deployment>("cloud");
  const [billing, setBilling] = useState<Billing>("annual");
  const [modules, setModules] = useState<string[]>(["electrical"]);
  const [seats, setSeats] = useState(3);
  const [sites, setSites] = useState(1);
  const [contractor, setContractor] = useState(false);

  const input: CalculatorInput = { deployment, billing, modules, seats, sites, contractor };
  const quotes = useMemo(() => quoteAll(input), [deployment, billing, modules, seats, sites, contractor]);
  const best = quotes.find((q) => q.fits);

  const toggleModule = (key: string) =>
    setModules((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  return (
    <main className="min-h-screen bg-background text-foreground px-6 py-12">
      <div className="mx-auto max-w-5xl">
        <Link
          to="/demo/farmops_o_s"
          search={{ slide: 13, view: undefined }}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary mb-6"
        >
          <ArrowLeft className="h-4 w-4" /> Back to the FarmOps O/S handout
        </Link>

        <p className="text-sm uppercase tracking-widest text-primary mb-3">Proposed anchors</p>
        <h1 className="text-4xl font-semibold mb-3">Price your install</h1>
        <p className="text-muted-foreground max-w-2xl mb-10">
          The Procedures knowledge base is free forever in every column below. Choose where it runs,
          which modules you need, and how many people and properties it covers.
        </p>

        <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">What do you need?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <p className="text-sm font-medium mb-2">Where it runs</p>
                <div className="flex flex-wrap gap-2">
                  <Toggle active={deployment === "cloud"} onClick={() => setDeployment("cloud")}>
                    Hosted by FarmOps
                  </Toggle>
                  <Toggle active={deployment === "selfhost"} onClick={() => setDeployment("selfhost")}>
                    Your own hardware
                  </Toggle>
                </div>
              </div>

              {deployment === "cloud" && (
                <div>
                  <p className="text-sm font-medium mb-2">Billing</p>
                  <div className="flex flex-wrap gap-2">
                    <Toggle active={billing === "monthly"} onClick={() => setBilling("monthly")}>
                      Monthly
                    </Toggle>
                    <Toggle active={billing === "annual"} onClick={() => setBilling("annual")}>
                      Yearly (two months saved)
                    </Toggle>
                  </div>
                </div>
              )}

              <div>
                <p className="text-sm font-medium mb-2">Paid modules</p>
                <div className="space-y-2">
                  {PRICED_MODULES.map((m) => {
                    const on = modules.includes(m.key);
                    return (
                      <div key={m.key} className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggleModule(m.key)}
                          className={`flex-1 flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-left transition-colors ${
                            on
                              ? "border-primary bg-primary/10"
                              : "border-border text-muted-foreground hover:border-primary/50"
                          }`}
                        >
                          <span
                            className={`flex h-4 w-4 items-center justify-center rounded border ${
                              on ? "border-primary bg-primary text-primary-foreground" : "border-border"
                            }`}
                          >
                            {on && <Check className="h-3 w-3" />}
                          </span>
                          {m.name}
                          <Badge variant="outline" className="ml-auto text-[10px]">
                            {m.status}
                          </Badge>
                        </button>
                        <Link
                          to={m.route}
                          className="text-xs text-muted-foreground hover:text-primary whitespace-nowrap"
                        >
                          Open →
                        </Link>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Module pages need an account with that module granted.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Stepper label="People" value={seats} min={1} onChange={setSeats} />
                <Stepper label="Properties or sites" value={sites} min={1} onChange={setSites} />
              </div>

              <div>
                <p className="text-sm font-medium mb-2">Working as</p>
                <div className="flex flex-wrap gap-2">
                  <Toggle active={!contractor} onClick={() => setContractor(false)}>
                    One property
                  </Toggle>
                  <Toggle active={contractor} onClick={() => setContractor(true)}>
                    Contractor with customer sites
                  </Toggle>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className={best ? "border-primary" : undefined}>
              <CardHeader>
                <CardTitle className="text-base">
                  {best ? `Best fit — ${best.edition.name}` : "No edition covers that shape yet"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {best ? (
                  <>
                    <div className="flex flex-wrap items-baseline gap-3 mb-4">
                      <span className="text-3xl font-semibold tabular-nums">
                        {money(best.firstYear)}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        first year · {money(best.monthlyEquivalent)} per month equivalent
                      </span>
                    </div>
                    <ul className="space-y-2 mb-4">
                      {best.lines.map((l, i) => (
                        <li key={i} className="flex items-baseline justify-between gap-4 text-sm">
                          <span>
                            {l.label}
                            <span className="block text-xs text-muted-foreground">{l.detail}</span>
                          </span>
                          <span className="tabular-nums shrink-0">{money(l.amount)}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-sm text-muted-foreground">
                      Then {money(best.ongoingPerYear)} per year. Price anchor:{" "}
                      {editionAnchorText(best.edition.key)}.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button asChild size="sm">
                        <Link to="/subscription" search={{ tier: best.edition.key }}>
                          Get this plan
                        </Link>
                      </Button>
                      <span className="text-xs text-muted-foreground self-center">
                        Sign in to start it — a plan switches its modules on straight away.
                      </span>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Reduce people or sites, or switch where it runs — the comparison below shows what
                    each edition is missing.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Every edition, same shape</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {quotes.map((q) => (
                  <div
                    key={q.edition.key}
                    className={`rounded-md border px-3 py-2 ${
                      q.fits ? "border-border" : "border-dashed border-border opacity-70"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-medium">{q.edition.name}</span>
                      <span className="text-sm tabular-nums">
                        {q.fits ? money(q.firstYear) : "—"}
                      </span>
                    </div>
                    {q.fits ? (
                      <p className="text-xs text-muted-foreground">
                        first year, then {money(q.ongoingPerYear)} per year ·{" "}
                        <Link
                          to="/subscription"
                          search={{ tier: q.edition.key }}
                          className="hover:text-primary underline underline-offset-2"
                        >
                          get this plan
                        </Link>
                      </p>
                    ) : (
                      <ul className="mt-1 space-y-0.5">
                        {q.shortfalls.map((s, i) => (
                          <li key={i} className="text-xs text-muted-foreground">
                            {s}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>

        <p className="mt-10 flex items-start gap-2 text-xs text-muted-foreground max-w-3xl">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          {PRICING_DISCLAIMER}
        </p>
      </div>
    </main>
  );
}
