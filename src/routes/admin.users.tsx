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
import { ShieldCheck, ShieldX, ShieldQuestion, RefreshCw } from "lucide-react";

import { AppLayout } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
  listUsers,
  setApprovalStatus,
  setUserRoles,
  type AppRole,
  type ApprovalStatus,
  type ManagedUser,
} from "@/lib/admin.functions";

export const Route = createFileRoute("/admin/users")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({ meta: [{ title: "User management — Bostead Farms" }] }),
  component: UsersPage,
});

const ALL_ROLES: AppRole[] = ["viewer", "editor", "admin"];

function UsersPage() {
  const profile = useCurrentProfile();
  const fetchUsers = useServerFn(listUsers);
  const usersQ = useQuery<ManagedUser[]>({
    queryKey: ["admin", "users"],
    queryFn: () => fetchUsers(),
    enabled: profile.data?.isAdmin === true,
  });

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
  const [pendingRoles, setPendingRoles] = useState<AppRole[] | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin", "users"] });
    qc.invalidateQueries({ queryKey: ["my-profile"] });
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
    mutationFn: (roles: AppRole[]) => rolesFn({ data: { userId: user.id, roles } }),
    onSuccess: () => {
      toast.success("Roles updated");
      setPendingRoles(null);
      invalidate();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const effectiveRoles = pendingRoles ?? user.roles;
  const isSelf = user.id === currentUserId;
  const dirty =
    pendingRoles !== null &&
    (pendingRoles.length !== user.roles.length ||
      pendingRoles.some((r) => !user.roles.includes(r)));

  const toggleRole = (role: AppRole, on: boolean) => {
    const base = pendingRoles ?? user.roles;
    const next = on ? Array.from(new Set([...base, role])) : base.filter((r) => r !== role);
    setPendingRoles(next);
  };

  return (
    <TableRow>
      <TableCell className="align-top">
        <div className="font-medium">{user.email ?? "(no email)"}</div>
        {user.display_name && (
          <div className="text-xs text-muted-foreground">{user.display_name}</div>
        )}
        <div className="text-[11px] text-muted-foreground mt-1 font-mono">{user.id.slice(0, 8)}…</div>
        {isSelf && <Badge variant="secondary" className="mt-1">you</Badge>}
      </TableCell>
      <TableCell className="align-top">
        <StatusBadge status={user.status} />
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
              {role === "viewer" && (
                <span className="text-xs text-muted-foreground">(read-only)</span>
              )}
            </label>
          ))}
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
        {dirty && (
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPendingRoles(null)}
              disabled={rolesMut.isPending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => rolesMut.mutate(pendingRoles!)}
              disabled={rolesMut.isPending}
            >
              Save roles
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

function StatusBadge({ status }: { status: ApprovalStatus }) {
  if (status === "approved") return <Badge className="bg-emerald-600">Approved</Badge>;
  if (status === "rejected") return <Badge variant="destructive">Rejected</Badge>;
  return <Badge variant="secondary">Pending</Badge>;
}
