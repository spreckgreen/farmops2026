// Admin-only SMTP relay configuration. Values persist to the encrypted shared
// vault, so changes take effect without a redeploy. The password field is
// write-only: leaving it blank keeps whatever is already stored.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, CheckCircle2, Mail, Plug, Save } from "lucide-react";
import {
  getSmtpConfig,
  saveSmtpConfig,
  testSmtpConnection,
  type SmtpTestResult,
} from "@/lib/smtp.functions";
import { defaultPortFor, type SmtpSecurity } from "@/lib/smtp-config";

type FormState = {
  enabled: boolean;
  host: string;
  port: string;
  security: SmtpSecurity;
  username: string;
  password: string;
  fromAddress: string;
  replyTo: string;
};

const EMPTY: FormState = {
  enabled: false,
  host: "",
  port: "587",
  security: "starttls",
  username: "",
  password: "",
  fromAddress: "",
  replyTo: "",
};

export function SmtpConfigCard() {
  const qc = useQueryClient();
  const loadFn = useServerFn(getSmtpConfig);
  const saveFn = useServerFn(saveSmtpConfig);
  const testFn = useServerFn(testSmtpConnection);

  const state = useQuery({
    queryKey: ["smtp-config"],
    queryFn: () => loadFn(),
    staleTime: 60 * 1000,
  });

  const [form, setForm] = useState<FormState>(EMPTY);
  const [test, setTest] = useState<SmtpTestResult | null>(null);
  const cfg = state.data;

  useEffect(() => {
    if (!cfg) return;
    setForm({
      enabled: cfg.enabled,
      host: cfg.host,
      port: String(cfg.port),
      security: cfg.security,
      username: cfg.username,
      password: "",
      fromAddress: cfg.fromAddress,
      replyTo: cfg.replyTo ?? "",
    });
  }, [cfg]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          enabled: form.enabled,
          host: form.host,
          port: Number(form.port || 0),
          security: form.security,
          username: form.username,
          // null keeps the stored password untouched.
          password: form.password.length ? form.password : null,
          fromAddress: form.fromAddress,
          replyTo: form.replyTo.length ? form.replyTo : null,
        },
      }),
    onSuccess: () => {
      toast.success("SMTP settings saved");
      setForm((f) => ({ ...f, password: "" }));
      qc.invalidateQueries({ queryKey: ["smtp-config"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runTest = useMutation({
    mutationFn: () => testFn(),
    onSuccess: (r: SmtpTestResult) => {
      setTest(r);
      if (r.ok) toast.success(`Relay answered in ${r.latencyMs} ms`);
      else toast.error(`SMTP test failed: ${r.error ?? "unknown error"}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="h-4 w-4" />
          SMTP configuration
          {cfg && (
            <Badge
              variant={cfg.enabled && cfg.ready ? "secondary" : "destructive"}
              className="ml-2"
            >
              {!cfg.ready ? "Incomplete" : cfg.enabled ? "Enabled" : "Saved (off)"}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Outbound mail relay for this deployment (admin notifications such as
          panel edit-access requests). Stored encrypted in the shared vault —
          no redeploy needed.
        </p>

        {state.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {state.error && (
          <div className="text-sm text-destructive">
            Failed to load: {(state.error as Error).message}
          </div>
        )}

        {cfg && (
          <>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <div className="text-sm font-medium">Send mail through this relay</div>
                <div className="text-xs text-muted-foreground">
                  Turning this off keeps every setting but stops all outbound sends.
                </div>
              </div>
              <Switch
                checked={form.enabled}
                onCheckedChange={(v) => set("enabled", v)}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="smtp-host">Host (required)</Label>
                <Input
                  id="smtp-host"
                  placeholder="smtp.fastmail.com"
                  value={form.host}
                  onChange={(e) => set("host", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="smtp-port">Port (required)</Label>
                <Input
                  id="smtp-port"
                  inputMode="numeric"
                  placeholder="587"
                  value={form.port}
                  onChange={(e) => set("port", e.target.value.replace(/[^0-9]/g, ""))}
                />
              </div>
              <div className="space-y-1">
                <Label>Security</Label>
                <Select
                  value={form.security}
                  onValueChange={(v) => {
                    const sec = v as SmtpSecurity;
                    setForm((f) => ({ ...f, security: sec, port: String(defaultPortFor(sec)) }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="starttls">STARTTLS (port 587)</SelectItem>
                    <SelectItem value="tls">Implicit TLS / SMTPS (port 465)</SelectItem>
                    <SelectItem value="none">None — plain SMTP (port 25)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="smtp-user">
                  Username{form.security === "none" ? " (optional)" : " (required)"}
                </Label>
                <Input
                  id="smtp-user"
                  autoComplete="off"
                  placeholder="notify@bostead.life"
                  value={form.username}
                  onChange={(e) => set("username", e.target.value)}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="smtp-pass">
                  Password / app token
                  {cfg.hasPassword ? " (stored — leave blank to keep)" : ""}
                </Label>
                <Input
                  id="smtp-pass"
                  type="password"
                  autoComplete="new-password"
                  placeholder={cfg.hasPassword ? "••••••••  (unchanged)" : "app-specific password"}
                  value={form.password}
                  onChange={(e) => set("password", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="smtp-from">From address (required)</Label>
                <Input
                  id="smtp-from"
                  placeholder="FarmOps &lt;notify@bostead.life&gt;"
                  value={form.fromAddress}
                  onChange={(e) => set("fromAddress", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="smtp-reply">Reply-To (optional)</Label>
                <Input
                  id="smtp-reply"
                  placeholder="rich@bostead.life"
                  value={form.replyTo}
                  onChange={(e) => set("replyTo", e.target.value)}
                />
              </div>
            </div>

            {cfg.issues.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-900 dark:text-amber-100">
                <div className="font-semibold flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Saved config can't send yet
                </div>
                <ul className="mt-1 list-disc pl-5 text-xs space-y-0.5">
                  {cfg.issues.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => save.mutate()} disabled={save.isPending}>
                <Save className="h-4 w-4 mr-1" />
                {save.isPending ? "Saving…" : "Save SMTP settings"}
              </Button>
              <Button
                variant="outline"
                onClick={() => runTest.mutate()}
                disabled={runTest.isPending || !cfg.host}
                title="Connects to the saved relay and reads its greeting"
              >
                <Plug className="h-4 w-4 mr-1" />
                {runTest.isPending ? "Testing…" : "Test connection"}
              </Button>
            </div>

            {test && (
              <div className="rounded-md border p-3 text-xs font-mono space-y-1">
                <div className="flex items-center gap-2">
                  {test.ok ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-red-600" />
                  )}
                  {test.target} · {test.latencyMs} ms
                </div>
                {test.banner && <div className="break-words">{test.banner}</div>}
                {test.error && <div className="text-red-600 break-words">{test.error}</div>}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
