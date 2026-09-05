// Admin-only user management panel: lists every profile with approval status
// and roles, lets an admin approve/reject sign-ups, and lets them toggle
// viewer / editor / admin roles per user.
//
// Lives under `_authenticated/` so the integration-managed auth gate handles
// sign-in. Admin enforcement happens server-side in `requireAdmin`; we also
// hide the page client-side and render an "access denied" panel for
// non-admins so they don't get a confusing error.

import { createFileRoute } from "@tanstack/react-router";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, ShieldX, ShieldQuestion, RefreshCw, MailCheck, KeyRound, MailOpen, Ban, Play, UserPlus, Sparkles } from "lucide-react";

import { AppLayout } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CsvToolbar } from "@/components/csv-toolbar";
import { useCurrentProfile } from "@/hooks/use-current-profile";
import {
  confirmAllUnconfirmedUsers,
  confirmUserEmail,
  listUsers,
  setApprovalStatus,
  setUserDisabled,
  setUserPassword,
  setUserRoles,
  type AppRole,
  type ApprovalStatus,
  createUserAccount,
  type ManagedUser,
} from "@/lib/admin.functions";
import { ADDON_KEYS, isEntitlementActive, type AddonKey } from "@/lib/addons";
import {
  ELECTRICAL_AI_SCENARIOS,
  type ElectricalAiScenarioId,
} from "@/lib/electrical-ai-scenarios";
import {
  adminListElectricalAiFeatureGrants,
  adminSetElectricalAiFeatures,
  type AdminElectricalAiGrantRow,
} from "@/lib/electrical-ai-access.functions";
import { useAiUsageBill } from "@/components/ai-usage-bill";
import { formatBillUsd } from "@/lib/ai-usage";



export const Route = createFileRoute("/admin/users")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({ meta: [{ title: "User management — Bostead Farms" }] }),
  component: UsersPage,
});

const ALL_ROLES: AppRole[] = ["viewer", "editor", "admin", "electrician"];

const ADDON_LABEL: Record<AddonKey, string> = {
  electrical: "Electrical (full)",
  electrical_fieldwrite: "Electrical field write",
  electrical_readonly: "Electrical read-only",
  electrical_scan: "Scanned panel only",
  maintenance: "Maintenance module",
  inventory: "Inventory module",
  food: "Food & Growing module",
  cameras: "Cameras module",
};

const ADDON_HINT: Record<AddonKey, string> = {
  electrical: "(whole module + reconciliation tools)",
  electrical_fieldwrite: "(audited as-built writes)",
  electrical_readonly: "(electrician-viewable screens, read-only)",
  electrical_scan: "(only panels they scanned)",
  maintenance: "(usually granted by a plan)",
  inventory: "(usually granted by a plan)",
  food: "(usually granted by a plan)",
};

const ROLE_HINT: Record<AppRole, string> = {
  viewer: "(read-only)",
  editor: "(can change app data)",
  admin: "(users + settings)",
  electrician: "(Electrical tab only)",
};

function UsersPage() {
  const profile = useCurrentProfile();
  const fetchUsers = useServerFn(listUsers);
  const qc = useQueryClient();
  const usersQ = useQuery<ManagedUser[]>({
    queryKey: ["admin", "users"],
    queryFn: () => fetchUsers(),
    enabled: profile.data?.isAdmin === true,
  });

  const confirmAllFn = useServerFn(confirmAllUnconfirmedUsers);
  const confirmAllMut = useMutation({
    mutationFn: () => confirmAllFn(),
    onSuccess: (r) => {
      const n = r.confirmed.length;
      const f = r.failed.length;
      if (n === 0 && f === 0) toast.info("No unconfirmed users.");
      else toast.success(`Confirmed ${n} user${n === 1 ? "" : "s"}${f ? ` — ${f} failed` : ""}`);
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const unconfirmedCount = (usersQ.data ?? []).filter((u) => !u.email_confirmed_at).length;

  if (profile.isLoading) {
    return (
      <AppLayout>
        <div className="max-w-5xl mx-auto px-4 py-10 text-sm text-muted-foreground">
          Loading…
        </div>
      </AppLayout>
    );
  }

  if (!profile.data?.isAdmin) {
    return (
      <AppLayout>
        <div className="max-w-2xl mx-auto px-4 py-16 text-center space-y-3">
          <ShieldX className="h-10 w-10 mx-auto text-destructive" />
          <h1 className="text-xl font-semibold">Admins only</h1>
          <p className="text-sm text-muted-foreground">
            You need the <strong>admin</strong> role to manage other users.
          </p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">User management</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Approve or reject new sign-ups and assign roles. <strong>Viewer</strong>{" "}
              is read-only, <strong>editor</strong> can change app data, and{" "}
              <strong>admin</strong> can also manage users and app-level settings.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <CreateUserButton />
            <CsvToolbar
              filename="users.csv"
              columns={[
                { key: "email", label: "email" },
                { key: "display_name", label: "display_name" },
                { key: "status", label: "status" },
                { key: "roles", label: "roles" },
                { key: "reviewed_at", label: "reviewed_at" },
              ]}
              rows={(usersQ.data ?? []).map((u) => ({
                email: u.email ?? "",
                display_name: u.display_name ?? "",
                status: u.status ?? "",
                roles: (u.roles ?? []).join(";"),
                reviewed_at: u.reviewed_at ?? "",
              }))}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => confirmAllMut.mutate()}
              disabled={confirmAllMut.isPending || unconfirmedCount === 0}
              title="Mark every unconfirmed user's email as confirmed so they can sign in without the email link."
            >
              <MailOpen className={`h-4 w-4 mr-2 ${confirmAllMut.isPending ? "animate-pulse" : ""}`} />
              Confirm all unconfirmed{unconfirmedCount > 0 ? ` (${unconfirmedCount})` : ""}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => usersQ.refetch()}
              disabled={usersQ.isFetching}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${usersQ.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </header>

        {usersQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading users…</p>
        ) : usersQ.error ? (
          <p className="text-sm text-destructive">{(usersQ.error as Error).message}</p>
        ) : (
          <div className="border border-border rounded-lg bg-card/30 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(usersQ.data ?? []).map((u) => (
                  <UserRow key={u.id} user={u} currentUserId={profile.data!.id} />
                ))}
                {(usersQ.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                      No users yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function UserRow({ user, currentUserId }: { user: ManagedUser; currentUserId: string }) {
  const qc = useQueryClient();
  const approveFn = useServerFn(setApprovalStatus);
  const rolesFn = useServerFn(setUserRoles);
  const confirmFn = useServerFn(confirmUserEmail);
  const passwordFn = useServerFn(setUserPassword);
  const disableFn = useServerFn(setUserDisabled);
  const [pendingRoles, setPendingRoles] = useState<AppRole[] | null>(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [pwValue, setPwValue] = useState("");
  const [pendingAddons, setPendingAddons] = useState<AddonKey[] | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableReason, setDisableReason] = useState("");


  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin", "users"] });
    qc.invalidateQueries({ queryKey: ["my-profile"] });
    qc.invalidateQueries({ queryKey: ["my-addons"] });
    qc.invalidateQueries({ queryKey: ["admin", "entitlements"] });
  };

  const approveMut = useMutation({
    mutationFn: (status: ApprovalStatus) =>
      approveFn({ data: { userId: user.id, status } }),
    onSuccess: (_d, status) => {
      toast.success(`Marked ${user.email ?? "user"} as ${status}`);
      invalidate();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const rolesMut = useMutation({
    mutationFn: (vars: { roles: AppRole[]; addons: AddonKey[] }) =>
      rolesFn({ data: { userId: user.id, roles: vars.roles, addons: vars.addons } }),
    onSuccess: () => {
      toast.success("Roles and access updated — de-selected items were removed.");
      setPendingRoles(null);
      setPendingAddons(null);
      invalidate();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const confirmMut = useMutation({
    mutationFn: () => confirmFn({ data: { userId: user.id } }),
    onSuccess: () => {
      toast.success(`Confirmed email for ${user.email ?? "user"}`);
      invalidate();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const passwordMut = useMutation({
    mutationFn: (password: string) =>
      passwordFn({ data: { userId: user.id, password } }),
    onSuccess: () => {
      toast.success("Temporary password set. Share it securely with the user.");
      setPwOpen(false);
      setPwValue("");
      invalidate();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const disableMut = useMutation({
    mutationFn: (vars: { disabled: boolean; reason?: string }) =>
      disableFn({ data: { userId: user.id, disabled: vars.disabled, reason: vars.reason } }),
    onSuccess: (_d, vars) => {
      toast.success(
        vars.disabled
          ? `Disabled ${user.email ?? "user"} — roles and approval kept.`
          : `Re-enabled ${user.email ?? "user"}.`,
      );
      setDisableOpen(false);
      setDisableReason("");
      invalidate();
    },
    onError: (e) => toast.error((e as Error).message),
  });



  const generateTempPassword = () => {
    // 16-char URL-safe random string
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    const b64 = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    setPwValue(b64);
  };

  // Only *live* grants count as selected, so a previously revoked row shows as
  // unchecked and can be handed back by ticking it again.
  const activeAddons = (user.addons ?? [])
    .filter((a) => isEntitlementActive(a))
    .map((a) => a.addon_key as AddonKey);

  const effectiveRoles = pendingRoles ?? user.roles;
  const effectiveAddons = pendingAddons ?? activeAddons;
  const isSelf = user.id === currentUserId;
  const sameSet = (a: string[], b: string[]) =>
    a.length === b.length && a.every((x) => b.includes(x));
  const dirty =
    (pendingRoles !== null && !sameSet(pendingRoles, user.roles)) ||
    (pendingAddons !== null && !sameSet(pendingAddons, activeAddons));

  const toggleRole = (role: AppRole, on: boolean) => {
    const base = pendingRoles ?? user.roles;
    const next = on ? Array.from(new Set([...base, role])) : base.filter((r) => r !== role);
    setPendingRoles(next);
  };

  const toggleAddon = (key: AddonKey, on: boolean) => {
    const base = pendingAddons ?? activeAddons;
    const next = on ? Array.from(new Set([...base, key])) : base.filter((k) => k !== key);
    setPendingAddons(next);
  };

  const unconfirmed = user.email_confirmed_at === null;
  const disabled = user.disabled_at !== null;


  return (
    <TableRow>
      <TableCell className="align-top">
        <div className="font-medium">{user.email ?? "(no email)"}</div>
        {user.display_name && (
          <div className="text-xs text-muted-foreground">{user.display_name}</div>
        )}
        <div className="text-[11px] text-muted-foreground mt-1 font-mono">{user.id.slice(0, 8)}…</div>
        <div className="flex flex-wrap gap-1 mt-1">
          {isSelf && <Badge variant="secondary">you</Badge>}
          {unconfirmed ? (
            <Badge variant="destructive" className="text-[10px]">Email unconfirmed</Badge>
          ) : (
            <Badge variant="outline" className="text-[10px]">Email confirmed</Badge>
          )}
          {user.profile_missing && (
            <Badge variant="destructive" className="text-[10px]">No profile — sign-up never completed</Badge>
          )}
        </div>
        {user.last_sign_in_at && (
          <div className="text-[11px] text-muted-foreground mt-1">
            Last sign-in: {new Date(user.last_sign_in_at).toLocaleString()}
          </div>
        )}
      </TableCell>
      <TableCell className="align-top">
        <StatusBadge status={user.status} />
        {disabled && (
          <div className="mt-1 space-y-1">
            <Badge variant="destructive" className="text-[10px]">Disabled</Badge>
            <div className="text-[11px] text-muted-foreground">
              Since {new Date(user.disabled_at!).toLocaleString()}
              {user.disabled_reason ? ` — ${user.disabled_reason}` : ""}
            </div>
          </div>
        )}
        {user.reviewed_at && (
          <div className="text-[11px] text-muted-foreground mt-1">
            {new Date(user.reviewed_at).toLocaleString()}
          </div>
        )}

      </TableCell>
      <TableCell className="align-top">
        <div className="flex flex-col gap-1.5">
          {ALL_ROLES.map((role) => (
            <label key={role} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={effectiveRoles.includes(role)}
                onCheckedChange={(c) => toggleRole(role, c === true)}
                disabled={rolesMut.isPending || (isSelf && role === "admin")}
              />
              <span className="capitalize">{role}</span>
              <span className="text-xs text-muted-foreground">{ROLE_HINT[role]}</span>
            </label>
          ))}

          <div className="pt-2 mt-1 border-t border-border">
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
              Electrical access
            </div>
            {ADDON_KEYS.map((key) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={effectiveAddons.includes(key)}
                  onCheckedChange={(c) => toggleAddon(key, c === true)}
                  disabled={rolesMut.isPending}
                />
                <span>{ADDON_LABEL[key]}</span>
                <span className="text-xs text-muted-foreground">{ADDON_HINT[key]}</span>
              </label>
            ))}
          </div>
        </div>
      </TableCell>
      <TableCell className="align-top text-right space-y-2">
        <div className="flex justify-end gap-2 flex-wrap">
          {user.status !== "approved" && (
            <Button
              size="sm"
              onClick={() => approveMut.mutate("approved")}
              disabled={approveMut.isPending}
            >
              <ShieldCheck className="h-4 w-4 mr-1" />
              Approve
            </Button>
          )}
          {user.status !== "rejected" && !isSelf && (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => approveMut.mutate("rejected")}
              disabled={approveMut.isPending}
            >
              <ShieldX className="h-4 w-4 mr-1" />
              Reject
            </Button>
          )}
          {user.status === "rejected" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => approveMut.mutate("pending")}
              disabled={approveMut.isPending}
            >
              <ShieldQuestion className="h-4 w-4 mr-1" />
              Re-queue
            </Button>
          )}
        </div>
        <div className="flex justify-end gap-2 flex-wrap">
          {unconfirmed && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => confirmMut.mutate()}
              disabled={confirmMut.isPending}
              title="Mark this user's email as confirmed so they can sign in without clicking the confirmation link."
            >
              <MailCheck className="h-4 w-4 mr-1" />
              Confirm email
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPwOpen(true)}
            title="Set a temporary password. Share it securely — the user should change it after signing in."
          >
            <KeyRound className="h-4 w-4 mr-1" />
            Set password
          </Button>
          <AiBillBadge userId={user.id} />
          <AiFeaturesButton userId={user.id} email={user.email} />
          {!isSelf &&
            (disabled ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => disableMut.mutate({ disabled: false })}
                disabled={disableMut.isPending}
                title="Re-enable this account. Approval and roles were never removed."
              >
                <Play className="h-4 w-4 mr-1" />
                Enable
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDisableOpen(true)}
                disabled={disableMut.isPending}
                title="Temporarily block sign-in without rejecting the account or revoking add-ons."
              >
                <Ban className="h-4 w-4 mr-1" />
                Disable
              </Button>
            ))}
        </div>

        {dirty && (
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setPendingRoles(null);
                setPendingAddons(null);
              }}
              disabled={rolesMut.isPending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() =>
                rolesMut.mutate({ roles: effectiveRoles, addons: effectiveAddons })
              }
              disabled={rolesMut.isPending}
            >
              Save roles &amp; access
            </Button>
          </div>
        )}
      </TableCell>

      <Dialog open={pwOpen} onOpenChange={(o) => { setPwOpen(o); if (!o) setPwValue(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set temporary password</DialogTitle>
            <DialogDescription>
              For <span className="font-mono">{user.email ?? user.id}</span>. This also
              confirms the email so they can sign in immediately. Share the password
              through a secure channel and ask them to change it after signing in.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="temp-pw">New password (min 8 chars)</Label>
            <div className="flex gap-2">
              <Input
                id="temp-pw"
                type="text"
                value={pwValue}
                onChange={(e) => setPwValue(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                minLength={8}
              />
              <Button type="button" variant="outline" onClick={generateTempPassword}>
                Generate
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPwOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => passwordMut.mutate(pwValue)}
              disabled={passwordMut.isPending || pwValue.length < 8}
            >
              {passwordMut.isPending ? "Saving…" : "Set password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={disableOpen}
        onOpenChange={(o) => { setDisableOpen(o); if (!o) setDisableReason(""); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disable account</DialogTitle>
            <DialogDescription>
              <span className="font-mono">{user.email ?? user.id}</span> keeps their
              approval, roles and data — they simply can't use the app until you
              enable them again. This is separate from rejecting a sign-up and from
              revoking an add-on, and carries no revocation strike.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="disable-reason">Reason (shown to the user, optional)</Label>
            <Input
              id="disable-reason"
              value={disableReason}
              onChange={(e) => setDisableReason(e.target.value)}
              placeholder="e.g. Contractor off site until spring"
              maxLength={300}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDisableOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => disableMut.mutate({ disabled: true, reason: disableReason })}
              disabled={disableMut.isPending}
            >
              {disableMut.isPending ? "Disabling…" : "Disable account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </TableRow>
  );
}

/**
 * Admin-created account. Self sign-up plus approval is the normal path; this
 * bypasses it entirely for someone who should just be able to sign in — the
 * email is pre-confirmed and the profile lands approved.
 */
function CreateUserButton() {
  const qc = useQueryClient();
  const createFn = useServerFn(createUserAccount);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [roles, setRoles] = useState<AppRole[]>(["electrician"]);
  const [addon, setAddon] = useState<
    "electrical_readonly" | "electrical_fieldwrite" | "electrical" | "none"
  >(
    "electrical_readonly",
  );

  const reset = () => {
    setEmail("");
    setName("");
    setPassword("");
    setRoles(["electrician"]);
    setAddon("electrical_readonly");
  };

  const generate = () => {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    setPassword(
      btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, ""),
    );
  };

  const createMut = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          email,
          password,
          display_name: name,
          roles,
          addon: addon === "none" ? null : addon,
        },
      }),
    onSuccess: (r) => {
      toast.success(r.message);
      setOpen(false);
      reset();
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      qc.invalidateQueries({ queryKey: ["admin", "entitlements"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const toggle = (role: AppRole, on: boolean) =>
    setRoles((prev) =>
      on ? Array.from(new Set([...prev, role])) : prev.filter((r) => r !== role),
    );

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4 mr-2" />
        Add user
      </Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a user directly</DialogTitle>
            <DialogDescription>
              Creates the account without waiting for self sign-up: the email is
              pre-confirmed and the profile is approved, so they can sign in with the
              password below straight away. Share it securely and ask them to change it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-email">Email</Label>
              <Input
                id="new-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="electrician@example.com"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-name">Display name (optional)</Label>
              <Input
                id="new-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Dale — site electrician"
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-pw">Temporary password (min 8 chars)</Label>
              <div className="flex gap-2">
                <Input
                  id="new-pw"
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button type="button" variant="outline" onClick={generate}>
                  Generate
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Roles</Label>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {ALL_ROLES.map((role) => (
                  <label key={role} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={roles.includes(role)}
                      onCheckedChange={(c) => toggle(role, c === true)}
                    />
                    <span className="capitalize">{role}</span>
                    <span className="text-xs text-muted-foreground">{ROLE_HINT[role]}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Electrical access</Label>
              <div className="flex flex-col gap-1.5 text-sm">
                {(
                  [
                    ["electrical_readonly", "Read-only — every electrician screen, no edits, no reconciliation tools"],
                    [
                      "electrical_fieldwrite",
                      "Field write — same screens, may record as-installed work; every change is audited for your review",
                    ],
                    ["electrical", "Full module — edits plus reconciliation (ODS import/export, validation, adjudication)"],
                    ["none", "None — no Electrical access"],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="new-user-electrical"
                      className="mt-1"
                      checked={addon === value}
                      onChange={() => setAddon(value)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createMut.mutate()}
              disabled={createMut.isPending || password.length < 8 || !email.includes("@")}
            >
              {createMut.isPending ? "Creating…" : "Create user"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function StatusBadge({ status }: { status: ApprovalStatus }) {
  if (status === "approved") return <Badge className="bg-emerald-600">Approved</Badge>;
  if (status === "rejected") return <Badge variant="destructive">Rejected</Badge>;
  return <Badge variant="secondary">Pending</Badge>;
}


const AI_REQUEST_BADGE: Record<string, string> = {
  pending: "requested",
  approved: "approved",
  rejected: "rejected",
  revoked: "revoked",
};

/**
 * AI feature management for one user — the admin side of the electrician's
 * request list. Ticked scenarios are approved; un-ticking an approved scenario
 * revokes it, and un-ticking a pending request turns it down. The row history
 * is kept either way, so you can see what was asked for and when.
 */
/**
 * Running 30-day AI bill for this user — metered cloud runs only, so a user who
 * stays on the self-hosted engine shows "$0.00 (0 cloud)".
 */
function AiBillBadge({ userId }: { userId: string }) {
  const q = useAiUsageBill(30);
  const row = q.data?.rows.find((r) => r.userId === userId);
  const cost = row?.costUsd ?? 0;
  return (
    <Badge
      variant={cost > 0 ? "secondary" : "outline"}
      className="self-center"
      title={
        row
          ? `${row.runs} AI runs in 30 days, ${row.meteredRuns} on cloud AI. Top feature: ${row.byArea[0]?.label ?? "—"}.`
          : "No AI runs recorded in the last 30 days."
      }
    >
      AI 30d: {formatBillUsd(cost)}
      {row ? ` · ${row.meteredRuns} cloud` : ""}
    </Badge>
  );
}

function AiFeaturesButton({ userId, email }: { userId: string; email: string | null }) {
  const qc = useQueryClient();
  const listFn = useServerFn(adminListElectricalAiFeatureGrants);
  const saveFn = useServerFn(adminSetElectricalAiFeatures);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<ElectricalAiScenarioId[] | null>(null);
  const [note, setNote] = useState("");

  const grantsQ = useQuery<AdminElectricalAiGrantRow[]>({
    queryKey: ["admin", "electrical-ai-grants"],
    queryFn: () => listFn(),
  });

  const rows = (grantsQ.data ?? []).filter((r) => r.user_id === userId);
  // A scenario counts as "on" when it is approved, or when no decision was ever
  // recorded (their add-on entitlement still applies). Unticking writes an
  // explicit revoke, which overrides entitlement in the user's AI features tab.
  const approved = ELECTRICAL_AI_SCENARIOS.filter((def) => {
    const row = rows.find((r) => r.scenario === def.id);
    return !row || row.status === "approved";
  }).map((def) => def.id);
  const pendingCount = rows.filter((r) => r.status === "pending").length;
  const effective = picked ?? approved;

  const saveMut = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          userId,
          approved: effective,
          note: note.trim() || undefined,
        },
      }),
    onSuccess: () => {
      toast.success("AI features updated for this user.");
      setPicked(null);
      setNote("");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["admin", "electrical-ai-grants"] });
      qc.invalidateQueries({ queryKey: ["electrical-ai-scenarios"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const toggle = (id: ElectricalAiScenarioId, on: boolean) =>
    setPicked(on ? [...new Set([...effective, id])] : effective.filter((x) => x !== id));

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        title="Approve or revoke the Electrical AI scenarios this person may run."
      >
        <Sparkles className="h-4 w-4 mr-1" />
        AI features
        {pendingCount > 0 && (
          <Badge variant="destructive" className="ml-1 text-[10px]">
            {pendingCount}
          </Badge>
        )}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            setPicked(null);
            setNote("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>AI features</DialogTitle>
            <DialogDescription>
              <span className="font-mono">{email ?? userId}</span> — tick the Electrical AI
              scenarios they may run. Unticking a scenario switches it off for them even when
              their add-on would otherwise allow it. This enables the scenario only: it never
              widens which records they can read, and AI never writes an electrical record.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            {ELECTRICAL_AI_SCENARIOS.map((def) => {
              const row = rows.find((r) => r.scenario === def.id) ?? null;
              return (
                <label key={def.id} className="flex items-start gap-3 rounded-md border p-3">
                  <Checkbox
                    className="mt-0.5"
                    checked={effective.includes(def.id)}
                    onCheckedChange={(c) => toggle(def.id, c === true)}
                    disabled={saveMut.isPending}
                  />
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{def.label}</span>
                      {row && (
                        <Badge
                          variant={row.status === "pending" ? "destructive" : "outline"}
                          className="text-[10px]"
                        >
                          {AI_REQUEST_BADGE[row.status]}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{def.description}</p>
                    {row?.request_note && (
                      <p className="text-xs text-muted-foreground">
                        Their note: {row.request_note}
                      </p>
                    )}
                  </div>
                </label>
              );
            })}
          </div>

          <div className="space-y-2">
            <Label htmlFor={`ai-note-${userId}`}>Decision note (optional)</Label>
            <Input
              id={`ai-note-${userId}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Approved for the PNL-H1 reconciliation window"
              maxLength={500}
            />
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
              {saveMut.isPending ? "Saving…" : "Save AI features"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
