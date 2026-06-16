// Blocks rendering of the app shell until the signed-in user's profile is
// loaded and approved. Pending users see a waiting screen; rejected users
// see an explanation. Admins/editors/viewers fall through to children.

import type { ReactNode } from "react";
import { Loader2, Clock, ShieldX, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useRouter } from "@tanstack/react-router";
import { useCurrentProfile } from "@/hooks/use-current-profile";
import { useQueryClient } from "@tanstack/react-query";

export function ProfileGate({ children }: { children: ReactNode }) {
  const { data, isLoading, error, refetch } = useCurrentProfile();
  const router = useRouter();
  const qc = useQueryClient();

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
    return (
      <Centered>
        <AlertCircle className="h-8 w-8 text-destructive" />
        <h1 className="text-lg font-semibold">Couldn't load your profile</h1>
        <p className="text-sm text-muted-foreground max-w-md">
          {(error as Error).message}
        </p>
        <div className="flex gap-2">
          <Button onClick={() => refetch()}>Try again</Button>
          <Button variant="ghost" onClick={signOut}>Sign out</Button>
        </div>
      </Centered>
    );
  }

  if (!data) return null;

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

  return <>{children}</>;
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center bg-background">
      {children}
    </div>
  );
}
