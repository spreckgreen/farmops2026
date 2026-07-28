import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { reseedMyProfile, type ReseedResult } from "@/lib/admin.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, CheckCircle2, AlertTriangle, ShieldCheck } from "lucide-react";

export function ReseedProfileCard() {
  const reseed = useServerFn(reseedMyProfile);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReseedResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await reseed();
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const denied = result?.adminRole === "denied_admins_exist";
  const success = result && !denied;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" />
          Re-seed my profile &amp; admin role
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Re-creates your <code>profiles</code> row (status=approved) and grants
          the <code>admin</code> role for the currently signed-in account. Use
          this after a fresh self-hosted DB or a partial restore. For safety,
          admin is only auto-granted when no admin exists yet.
        </p>
        <Button onClick={run} disabled={busy} size="sm">
          <RefreshCw className={`h-4 w-4 mr-2 ${busy ? "animate-spin" : ""}`} />
          {busy ? "Running…" : "Re-seed now"}
        </Button>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-destructive">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">Failed</div>
              <div className="text-xs break-all">{error}</div>
            </div>
          </div>
        )}

        {result && (
          <div
            className={`flex items-start gap-2 rounded-md border p-3 ${
              denied
                ? "border-yellow-500/50 bg-yellow-500/10"
                : "border-green-500/50 bg-green-500/10"
            }`}
          >
            {success ? (
              <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-green-600" />
            ) : (
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-yellow-600" />
            )}
            <div className="space-y-1">
              <div className="font-medium">{denied ? "Partially applied" : "Success"}</div>
              <div className="text-xs">{result.message}</div>
              <ul className="text-xs text-muted-foreground list-disc pl-4">
                <li>Account: {result.email ?? "(no email)"}</li>
                <li>Profile: {result.profile}</li>
                <li>Admin role: {result.adminRole.replace(/_/g, " ")}</li>
              </ul>
              {success && (
                <div className="text-xs text-muted-foreground pt-1">
                  Hard-refresh the page (Ctrl+Shift+R) to pick up the new role.
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
