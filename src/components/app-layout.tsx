import { Link, useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { todayDateString } from "@/lib/slug";
import { ProfileGate } from "@/components/profile-gate";
import { useCurrentProfile } from "@/hooks/use-current-profile";
import { ShieldCheck } from "lucide-react";

export function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const today = todayDateString();
  const profile = useCurrentProfile();

  const signOut = async () => {
    await supabase.auth.signOut();
    router.navigate({ to: "/auth" });
  };

  const navItem =
    "px-3 py-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors";
  const navActive = { className: "px-3 py-1.5 rounded-md bg-accent text-foreground" };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b border-border bg-card/30 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Link to="/" className="font-bold tracking-tight">
              Bostead Farms
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <Link to="/tasks/backlog" className={navItem} activeProps={navActive}>
                Backlog
              </Link>
              <Link
                to="/notes/$date"
                params={{ date: today }}
                className={navItem}
                activeProps={navActive}
              >
                Today
              </Link>
              <Link to="/tasks" className={navItem} activeProps={navActive} activeOptions={{ exact: true }}>
                Tasks
              </Link>
              <Link to="/projects" className={navItem} activeProps={navActive}>
                Projects
              </Link>
              <Link to="/reports" className={navItem} activeProps={navActive}>
                Reports
              </Link>
              <Link to="/tasks/scheduled" className={navItem} activeProps={navActive}>
                Scheduled
              </Link>
              <Link to="/maintenance" className={navItem} activeProps={navActive}>
                Maintenance
              </Link>
              <Link to="/inventory" className={navItem} activeProps={navActive}>
                Inventory
              </Link>
              <Link to="/food" className={navItem} activeProps={navActive}>
                Food
              </Link>
              <Link to="/sync" className={navItem} activeProps={navActive}>
                Sync
              </Link>
              {profile.data?.isAdmin && (
                <Link
                  to="/admin/users"
                  className={`${navItem} flex items-center gap-1`}
                  activeProps={navActive}
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Users
                </Link>
              )}
            </nav>
          </div>
          <Button variant="ghost" size="sm" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </header>
      <main className="flex-1">
        <ProfileGate>{children}</ProfileGate>
      </main>
    </div>
  );
}
