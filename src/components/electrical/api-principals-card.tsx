// Management UI for scoped service principals of the read-only Electrical API.
// The plaintext key is shown exactly once, immediately after creation.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  createApiPrincipal,
  listApiPrincipals,
  setApiPrincipalDisabled,
} from "@/lib/electrical-api-principals.functions";

export function ApiPrincipalsCard() {
  const load = useServerFn(listApiPrincipals);
  const create = useServerFn(createApiPrincipal);
  const toggle = useServerFn(setApiPrincipalDisabled);
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [issued, setIssued] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["electrical-api-principals"],
    queryFn: () => load(),
  });

  const grantable = useMemo(() => query.data?.grantable ?? [], [query.data]);
  const selected = chosen.length ? chosen : grantable;

  const createMutation = useMutation({
    mutationFn: () => create({ data: { name, scopes: selected } }),
    onSuccess: (res) => {
      setIssued(res.key);
      setName("");
      setChosen([]);
      void qc.invalidateQueries({ queryKey: ["electrical-api-principals"] });
      toast.success("Service principal created. Copy the key now — it is not shown again.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleMutation = useMutation({
    mutationFn: (vars: { id: string; disabled: boolean }) => toggle({ data: vars }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["electrical-api-principals"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Service principals and scopes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          A principal is a named machine credential with a fixed scope set, sent as{" "}
          <code className="text-foreground">Authorization: Bearer farmops_sk_…</code>. Only
          the key fingerprint is stored, so a lost key is replaced rather than recovered.
        </p>

        <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-1">
            <Label htmlFor="principal-name">Name</Label>
            <Input
              id="principal-name"
              value={name}
              placeholder="Document generator (laptop)"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <Button
            disabled={!name.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? "Creating…" : "Create principal"}
          </Button>
        </div>

        <div className="space-y-1">
          <Label>Scopes</Label>
          <div className="flex flex-wrap gap-3">
            {grantable.map((scope) => (
              <label key={scope} className="flex items-center gap-2 text-xs">
                <Checkbox
                  checked={selected.includes(scope)}
                  onCheckedChange={(v) =>
                    setChosen((prev) => {
                      const base = prev.length ? prev : grantable;
                      return v ? [...new Set([...base, scope])] : base.filter((s) => s !== scope);
                    })
                  }
                />
                <code>{scope}</code>
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Write scopes stay ungrantable until Phase 2/3 acceptance activates them.
          </p>
        </div>

        {issued ? (
          <div className="rounded-md border border-primary/40 bg-primary/5 p-3">
            <div className="text-xs font-medium">Copy this key now — shown once</div>
            <code className="break-all text-xs">{issued}</code>
            <div className="pt-2">
              <Button size="sm" variant="outline" onClick={() => setIssued(null)}>
                I have stored it
              </Button>
            </div>
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">Name</th>
                <th className="py-1 pr-3">Key</th>
                <th className="py-1 pr-3">Scopes</th>
                <th className="py-1 pr-3">Last used</th>
                <th className="py-1">State</th>
              </tr>
            </thead>
            <tbody>
              {(query.data?.principals ?? []).map((p) => (
                <tr key={p.id} className="border-t border-border align-top">
                  <td className="py-1 pr-3">{p.name}</td>
                  <td className="py-1 pr-3 font-mono">{p.key_prefix}…</td>
                  <td className="py-1 pr-3 font-mono">{p.scopes.join(", ")}</td>
                  <td className="py-1 pr-3">
                    {p.last_used_at ? new Date(p.last_used_at).toLocaleString() : "never"}
                  </td>
                  <td className="py-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={p.disabled_at ? "outline" : "secondary"}>
                        {p.disabled_at ? "disabled" : "active"}
                      </Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={toggleMutation.isPending}
                        onClick={() =>
                          toggleMutation.mutate({ id: p.id, disabled: !p.disabled_at })
                        }
                      >
                        {p.disabled_at ? "Enable" : "Disable"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {!query.isLoading && !(query.data?.principals ?? []).length ? (
                <tr className="border-t border-border">
                  <td className="py-2 text-muted-foreground" colSpan={5}>
                    No service principals yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
