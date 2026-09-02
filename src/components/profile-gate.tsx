// Blocks rendering of the app shell until the signed-in user's profile is
// loaded and approved. Pending users see a waiting screen; rejected users
// see an explanation. Admins/editors/viewers fall through to children.

import { useEffect, type ReactNode } from "react";
import { Loader2, Clock, ShieldX, AlertCircle, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { electricianPathAllowed, isElectricianScoped } from "@/lib/electrical-access";
import { useCurrentProfile } from "@/hooks/use-current-profile";
import { useQueryClient } from "@tanstack/react-query";

export function ProfileGate({ children }: { children: ReactNode }) {
  const { data, isLoading, error, refetch } = useCurrentProfile();
  const router = useRouter();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (st) => st.location.pathname });

  // Electrical is the landing tab for an electrician-scoped account: signing in
  // drops them on `/` (today's note), which is not theirs, so move them across
  // without making them click through a denial screen.
  const misplacedElectrician =
    data?.status === "approved" &&
    isElectricianScoped(data.roles, data.isAdmin) &&
    !electricianPathAllowed(pathname);

  useEffect(() => {
    if (misplacedElectrician) {
      void router.navigate({ to: "/electrical", replace: true });
    }
  }, [misplacedElectrician, router]);


  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    router.navigate({ to: "/auth", replace: true });
  };

  if (isLoading) {
    return (
      <Centered>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading your profile…</p>
      </Centered>
    );
  }

  if (error) {
    const message = (error as Error).message;
    const expired = message.includes("Unauthorized");
    return (
      <Centered>
        <AlertCircle className="h-8 w-8 text-destructive" />
        <h1 className="text-lg font-semibold">
          {expired ? "Your session expired" : "Couldn't load your profile"}
        </h1>
        <p className="text-sm text-muted-foreground max-w-md">
          {expired ? "Sign in again to continue." : message}
        </p>
        <div className="flex gap-2">
          {expired ? (
            <Button onClick={signOut}>Sign in again</Button>
          ) : (
            <>
              <Button onClick={() => refetch()}>Try again</Button>
              <Button variant="ghost" onClick={signOut}>Sign out</Button>
            </>
          )}
        </div>
      </Centered>
    );
  }


  if (!data) return null;

  // Administrative suspension outranks approval status: a disabled account keeps
  // its approval and roles but cannot use the app until re-enabled.
  if (data.disabled_at) {
    return (
      <Centered>
        <Ban className="h-8 w-8 text-destructive" />
        <h1 className="text-lg font-semibold">Account disabled</h1>
        <p className="text-sm text-muted-foreground max-w-md">
          An administrator has temporarily disabled this account
          {data.disabled_reason ? `: ${data.disabled_reason}` : "."} Your data is
          untouched — an administrator can re-enable it at any time.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()}>Check again</Button>
          <Button variant="ghost" onClick={signOut}>Sign out</Button>
        </div>
      </Centered>
    );
  }



  if (data.status === "pending") {
    return (
      <Centered>
        <Clock className="h-8 w-8 text-amber-500" />
        <h1 className="text-lg font-semibold">Waiting for approval</h1>
        <p className="text-sm text-muted-foreground max-w-md">
          Your account ({data.email ?? "—"}) is pending review. An administrator
          will approve or reject it shortly.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()}>Check again</Button>
          <Button variant="ghost" onClick={signOut}>Sign out</Button>
        </div>
      </Centered>
    );
  }

  if (data.status === "rejected") {
    return (
      <Centered>
        <ShieldX className="h-8 w-8 text-destructive" />
        <h1 className="text-lg font-semibold">Access denied</h1>
        <p className="text-sm text-muted-foreground max-w-md">
          An administrator has rejected this account. If you believe this is a
          mistake, contact a Bostead Farms admin.
        </p>
        <Button variant="ghost" onClick={signOut}>Sign out</Button>
      </Centered>
    );
  }

  // Scope enforcement: the `electrician` role is Electrical-only. Hiding the
  // navigation is not enough — a bookmarked or typed URL such as `/inventory`
  // must not render either, so send them back to their own area.
  if (isElectricianScoped(data.roles, data.isAdmin) && !electricianPathAllowed(pathname)) {
    return (
      <Centered>
        <ShieldX className="h-8 w-8 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Electrical access only</h1>
        <p className="text-sm text-muted-foreground max-w-md">
          Your account is scoped to the Electrical area of Bostead Farms. The rest
          of the farm app (tasks, inventory, maintenance, admin tools) is not part
          of this access level.
        </p>
        <div className="flex gap-2">
          <Button onClick={() => router.navigate({ to: "/electrical", replace: true })}>
            Go to Electrical
          </Button>
          <Button variant="ghost" onClick={signOut}>Sign out</Button>
        </div>
      </Centered>
    );
  }

  return <>{children}</>;
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center bg-background">
      {children}
    </div>
  );
}
