import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AppLayout } from "@/components/app-layout";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { AlertTriangle, Check, Copy, Server, Settings, Terminal } from "lucide-react";

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
