import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getRecentServerLogs } from "@/lib/diag-logs.functions";
import { AppLayout } from "@/components/app-layout";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  Copy,
  Loader2,
  HeartPulse,
  ShieldCheck,
  PlugZap,
  ScrollText,
  Server,
  Settings,
  Terminal,
} from "lucide-react";

export const Route = createFileRoute("/settings/troubleshooting")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({
    meta: [
      { title: "Self-Host Troubleshooting — Bostead" },
      {
        name: "description",
        content:
          "Diagnose 502 Bad Gateway on a self-hosted Bostead VPS with one-command checks for Caddy to app connectivity, container health, and env loading.",
      },
      { property: "og:title", content: "Self-Host Troubleshooting — Bostead" },
      {
        property: "og:description",
        content:
          "Common 502 causes on a self-hosted Bostead install plus copy-paste checks for Caddy to app connectivity.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TroubleshootingPage,
});

const APP_DIR = "~/bostead-a29954a1";

const READY_SNIPPET = `cd ${APP_DIR} && docker compose exec -T caddy sh -lc '
command -v curl >/dev/null 2>&1 || apk add --no-cache curl >/dev/null 2>&1
for path in /health /ready; do
  printf "caddy->app %-8s " "$path"
  curl -sS -o /tmp/probe.json -w "status=%{http_code} total=%{time_total}s" "http://app:3000$path" || printf "UNREACHABLE"
  echo
  cat /tmp/probe.json 2>/dev/null; echo
done
' && for path in /health /ready; do printf "https  %-8s " "$path"; curl -sS -o /dev/null -w "status=%{http_code} total=%{time_total}s\\n" "https://$(hostname -f)$path"; done`;

const HEALTH_SNIPPET = `cd ${APP_DIR} && docker compose exec -T app sh -lc '
echo "--- inside app container (is the server up at all?) ---"
wget -qO- http://localhost:3000/health || echo "app: no response on localhost:3000"
' && docker compose exec -T caddy sh -lc '
echo
echo "--- caddy -> app (the hop that 502s) ---"
command -v curl >/dev/null 2>&1 || apk add --no-cache curl >/dev/null 2>&1
curl -sS -o /tmp/h.json -w "status=%{http_code} total=%{time_total}s\\n" http://app:3000/health && cat /tmp/h.json && echo
' && echo && echo "--- through Caddy over HTTPS (what the browser sees) ---" && curl -sS -o /dev/null -w "status=%{http_code} total=%{time_total}s\\n" https://$(hostname -f)/health`;

const CONNECTIVITY_SNIPPET = `cd ${APP_DIR} && docker compose exec -T caddy sh -lc '
set -u
URL=http://app:3000/

echo "--- wget (busybox, always present in caddy:alpine) ---"
wget -S -qO /tmp/probe.html "$URL" 2>&1 | grep -E "HTTP/|Location|Connecting|failed" || echo "wget: no response"
echo "bytes: $(wc -c < /tmp/probe.html 2>/dev/null || echo 0)"
echo "first 120 chars: $(head -c 120 /tmp/probe.html 2>/dev/null)"

echo
echo "--- curl (installed on demand, shows status + timing) ---"
command -v curl >/dev/null 2>&1 || apk add --no-cache curl >/dev/null 2>&1
if command -v curl >/dev/null 2>&1; then
  curl -sS -o /dev/null -w "status=%{http_code} dns=%{time_namelookup}s connect=%{time_connect}s total=%{time_total}s size=%{size_download}\n" "$URL" \
    || echo "curl: connection failed (app down or not on this network)"
else
  echo "curl unavailable and apk add failed (no egress?) — rely on the wget result above"
fi
'`;

function CommandBlock({ command, note }: { command: string; note?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Clipboard blocked — select the text and copy manually");
    }
  };
  return (
    <div className="rounded-md border bg-muted/40">
      <div className="flex items-start gap-2 p-3">
        <Terminal className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <pre className="flex-1 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
          {command}
        </pre>
        <Button variant="ghost" size="sm" onClick={copy} aria-label="Copy command">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
      {note ? (
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">{note}</p>
      ) : null}
    </div>
  );
}

type Cause = {
  title: string;
  symptom: string;
  fix: string;
  command: string;
};

const CAUSES: Cause[] = [
  {
    title: "App container isn't running",
    symptom:
      "docker compose ps lists only caddy and ollama, or app shows Exited / Restarting. Caddy answers, but has nothing behind app:3000.",
    fix: "Start it and read the exit reason from the tail of the log.",
    command: `cd ${APP_DIR} && docker compose up -d app && docker compose ps && docker compose logs --tail=60 app`,
  },
  {
    title: "App was OOM-killed (usually by Ollama)",
    symptom:
      "app shows Exited (137) with no stack trace. Free RAM near zero while a local model is loaded.",
    fix: "Stop Ollama or switch to a 1B model, then restart the app.",
    command: `free -h && docker stats --no-stream\n# if RAM is tight:\ncd ${APP_DIR} && docker compose stop ollama && docker compose up -d app`,
  },
  {
    title: "App listening on the wrong address",
    symptom:
      "Startup banner missing HOST: 0.0.0.0 / PORT: 3000. Binding to 127.0.0.1 inside the container is unreachable from Caddy.",
    fix: "Confirm the banner, then verify HOST/PORT in compose.",
    command: `cd ${APP_DIR} && docker compose logs app | grep -A6 "\\[server\\]" | head -20`,
  },
  {
    title: "Crash after boot (missing env / bad Supabase URL)",
    symptom:
      "Banner prints, then the process dies — often 'Missing Supabase environment variable(s)' or a URL that wrongly includes a port or /auth/v1 path.",
    fix: "Check .env.local is read and the URL is a bare origin.",
    command: `cd ${APP_DIR} && grep -c . .env.local && grep -E '^(VITE_)?SUPABASE_URL=' .env.local`,
  },
  {
    title: "Caddy and app not on the same network",
    symptom:
      "App is healthy and answers locally, but Caddy logs 'dial tcp: lookup app'. The service name can't resolve.",
    fix: "Prove the proxy hop from inside the Caddy container.",
    command: `cd ${APP_DIR} && docker compose exec caddy wget -qO- http://app:3000/ | head -c 200`,
  },
  {
    title: "Wrong port requested in the browser",
    symptom:
      "https://host:3000 fails while the plain domain works. Only 80/443 are published; 3000 is internal.",
    fix: "Use the domain without a port, and clear HSTS for the host if the browser pinned it.",
    command: `curl -sSI https://farmops.bostead.life/ | head -5`,
  },
];

const WINDOWS = [
  { label: "Last 2 min", seconds: 120 },
  { label: "Last 10 min", seconds: 600 },
  { label: "Last 30 min", seconds: 1800 },
];

function LogTailCard() {
  const fetchLogs = useServerFn(getRecentServerLogs);
  const [windowSeconds, setWindowSeconds] = useState(120);
  const tail = useMutation({
    mutationFn: (seconds: number) => fetchLogs({ data: { windowSeconds: seconds } }),
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not read server logs"),
  });

  const run = (seconds: number) => {
    setWindowSeconds(seconds);
    tail.mutate(seconds);
  };
  const result = tail.data;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ScrollText className="h-4 w-4 text-muted-foreground" />
          Tail app + Caddy logs
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Reads the app's recent console output and the Caddy access log without a shell. Admin
          only; obvious secrets are redacted.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {WINDOWS.map((w) => (
            <Button
              key={w.seconds}
              size="sm"
              variant={w.seconds === 120 ? "default" : "outline"}
              disabled={tail.isPending}
              onClick={() => run(w.seconds)}
            >
              {tail.isPending && windowSeconds === w.seconds ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {w.label}
            </Button>
          ))}
          {result ? (
            <span className="text-xs text-muted-foreground">
              fetched {new Date(result.generatedAt).toLocaleTimeString()}
            </span>
          ) : null}
        </div>

        {result ? (
          <div className="space-y-4 pt-1">
            {(
              [
                ["app (bostead)", result.app],
                ["caddy (proxy hop)", result.caddy],
              ] as const
            ).map(([label, tailData]) => (
              <div key={label} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{label}</span>
                  <Badge variant={tailData.available ? "secondary" : "destructive"}>
                    {tailData.available ? `${tailData.lines.length} lines` : "unavailable"}
                  </Badge>
                </div>
                {tailData.lines.length ? (
                  <pre className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
                    {tailData.lines.join("\n")}
                  </pre>
                ) : (
                  <p className="text-xs text-muted-foreground">{tailData.reason}</p>
                )}
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TroubleshootingPage() {
  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
        <header className="space-y-2">
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5 text-muted-foreground" />
            <Badge variant="secondary">Self-host</Badge>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Self-host troubleshooting: 502 Bad Gateway
          </h1>
          <p className="text-sm text-muted-foreground">
            A 502 means Caddy is up but nothing answered on <code className="font-mono">app:3000</code>.
            Run the two checks below first — they identify the cause in almost every case — then work
            through the matching section.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Start here — two commands</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <CommandBlock
              command={`cd ${APP_DIR} && docker compose ps && docker compose logs --tail=80 app`}
              note="Container state plus the reason it stopped. Exited (137) = out of memory; no startup banner = it never booted."
            />
            <CommandBlock
              command={`cd ${APP_DIR} && docker compose exec caddy wget -qO- http://app:3000/ | head -c 200`}
              note="Bypasses TLS and DNS entirely. HTML back = the app is fine and the problem is the proxy hop or your browser. Nothing back = the app is down."
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
              Readiness endpoint &mdash; <code className="font-mono text-sm">GET /ready</code>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              <code className="font-mono">/health</code> answers &ldquo;the server booted&rdquo;.{" "}
              <code className="font-mono">/ready</code> answers &ldquo;it can actually serve a
              page&rdquo;: required env vars present, and the backend reachable over the network.
              Returns <code className="font-mono">200</code> when ready,{" "}
              <code className="font-mono">503</code> when any check fails &mdash; never any secret
              values, only check names and short reasons.
            </p>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
{`{"ok":true,"service":"bostead","status":"ready","durationMs":489,
 "checks":[{"name":"env","status":"pass","durationMs":0},
           {"name":"database","status":"pass","durationMs":489,"detail":"HTTP 200"}]}`}
            </pre>
            <p className="text-sm text-muted-foreground">
              One command checks both endpoints end-to-end &mdash; from Caddy to the app, then
              through HTTPS as the browser sees it:
            </p>
            <CommandBlock command={READY_SNIPPET} />
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>
                All four <code className="font-mono">status=200</code> &mdash; the stack is ready
                end-to-end; a browser 502 is stale or cached.
              </li>
              <li>
                <code className="font-mono">/health</code> 200 but{" "}
                <code className="font-mono">/ready</code> 503 &mdash; the app is up but a dependency
                is not: read the failing check&apos;s <code className="font-mono">detail</code>{" "}
                (missing env var, or the backend refusing/timing out).
              </li>
              <li>
                Caddy hop 200 but HTTPS fails &mdash; TLS/vhost/DNS problem, not the app.
              </li>
              <li>
                Behind published-site auth, poll{" "}
                <code className="font-mono">/api/public/ready</code> instead &mdash; same report, no
                auth gate.
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <HeartPulse className="h-4 w-4 text-muted-foreground" />
              Health endpoint &mdash; <code className="font-mono text-sm">GET /health</code>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              A no-auth, no-database endpoint that answers in milliseconds. A{" "}
              <code className="font-mono">200</code> means the Node server booted and is routing
              requests. Response:
            </p>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
{`{"ok":true,"service":"bostead","status":"ready","uptimeSeconds":312,"checkedAt":"2026-08-20T18:26:04.118Z"}`}
            </pre>
            <p className="text-sm text-muted-foreground">
              Check it at all three layers in one snippet &mdash; inside the app container, from
              Caddy, then through HTTPS. Whichever layer first stops returning{" "}
              <code className="font-mono">status=200</code> is the broken one.
            </p>
            <CommandBlock command={HEALTH_SNIPPET} />
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>All three 200 &mdash; the app is ready; a 502 in your browser is stale or cached.</li>
              <li>
                App container 200 but caddy hop fails &mdash; networking: caddy and app are not on
                the same compose network, or the app binds 127.0.0.1 instead of 0.0.0.0.
              </li>
              <li>
                App container returns nothing &mdash; the server never booted; read the app log tail
                above for the crash line.
              </li>
              <li>
                Behind published-site auth, poll{" "}
                <code className="font-mono">/api/public/health</code> instead &mdash; same payload,
                no auth gate.
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <PlugZap className="h-4 w-4 text-muted-foreground" />
              Verify Caddy &rarr; app connectivity (wget + curl + status code)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              One copyable snippet, run inside the Caddy container so it tests the exact hop that
              returns the 502. It probes{" "}
              <code className="font-mono">http://app:3000/</code> twice: busybox{" "}
              <code className="font-mono">wget</code> (always available) for headers and body size,
              then <code className="font-mono">curl</code> for the HTTP status code and connect
              timings.
            </p>
            <CommandBlock command={CONNECTIVITY_SNIPPET} />
            <div className="rounded-md border p-3 text-sm">
              <p className="mb-2 font-medium">How to read it</p>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                <li>
                  <code className="font-mono">HTTP/1.1 200</code> and{" "}
                  <code className="font-mono">status=200</code> — the app is healthy; the 502 is
                  stale, browser-cached, or came from the other vhost.
                </li>
                <li>
                  <code className="font-mono">bad address &apos;app&apos;</code> /{" "}
                  <code className="font-mono">dns=0.000s</code> with a failure — the service name
                  won&apos;t resolve; caddy and app aren&apos;t on the same compose network.
                </li>
                <li>
                  <code className="font-mono">Connection refused</code> — DNS is fine but nothing is
                  listening: the app is down, or bound to 127.0.0.1 instead of 0.0.0.0.
                </li>
                <li>
                  <code className="font-mono">status=502</code> from curl here means the app itself
                  returned it (an upstream of its own), not Caddy.
                </li>
                <li>
                  Long <code className="font-mono">total</code> with{" "}
                  <code className="font-mono">status=000</code> — the app accepted the socket but
                  never answered; check the app tail above for a hung request.
                </li>
              </ul>
            </div>
            <CommandBlock
              command={`cd ${APP_DIR} && docker compose exec -T app sh -lc 'wget -S -qO- http://localhost:3000/ 2>&1 | head -5'`}
              note="Same probe from inside the app container. Works here but fails from caddy = networking; fails in both = the app isn't serving."
            />
          </CardContent>
        </Card>

        <LogTailCard />

        <section className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight">Common causes</h2>
          {CAUSES.map((c) => (
            <Card key={c.title}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-start gap-2 text-base">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  {c.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Symptom: </span>
                  {c.symptom}
                </p>
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Fix: </span>
                  {c.fix}
                </p>
                <CommandBlock command={c.command} />
              </CardContent>
            </Card>
          ))}
        </section>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Still down — clean rebuild</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Use this when routes 404 after a deploy or the bundle looks stale. Build args come from
              <code className="mx-1 font-mono">.env.local</code>, so run it from the app directory.
            </p>
            <CommandBlock
              command={`cd ${APP_DIR} && docker compose build --no-cache app && docker compose up -d app && ./scripts/healthcheck.sh`}
            />
            <div className="flex flex-wrap gap-2 pt-1">
              <Button asChild variant="outline" size="sm">
                <Link to="/settings/self-host">
                  <Settings className="mr-2 h-4 w-4" />
                  Self-host settings
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to="/admin/schema">Schema diagnostics</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
