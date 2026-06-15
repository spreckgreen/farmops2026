import { Link, useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { todayDateString } from "@/lib/slug";

export function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const today = todayDateString();

  const signOut = async () => {
    await supabase.auth.signOut();
    router.navigate({ to: "/auth" });
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b border-border bg-card/30 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Link to="/" className="font-bold tracking-tight">
              Bostead Farms
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <Link
                to="/notes/$date"
                params={{ date: today }}
                className="px-3 py-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                activeProps={{ className: "px-3 py-1.5 rounded-md bg-accent text-foreground" }}
              >
                Today
              </Link>
              <Link
                to="/tasks"
                className="px-3 py-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                activeProps={{ className: "px-3 py-1.5 rounded-md bg-accent text-foreground" }}
              >
                Tasks
              </Link>
              <Link
                to="/projects"
                className="px-3 py-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                activeProps={{ className: "px-3 py-1.5 rounded-md bg-accent text-foreground" }}
              >
                Projects
              </Link>
              <Link
                to="/reports"
                className="px-3 py-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                activeProps={{ className: "px-3 py-1.5 rounded-md bg-accent text-foreground" }}
              >
                Reports
              </Link>
              <Link
                to="/summaries"
                className="px-3 py-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                activeProps={{ className: "px-3 py-1.5 rounded-md bg-accent text-foreground" }}
              >
                Summaries
              </Link>
              <Link
                to="/maintenance"
                className="px-3 py-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                activeProps={{ className: "px-3 py-1.5 rounded-md bg-accent text-foreground" }}
              >
                Maintenance
              </Link>
              <Link
                to="/inventory"
                className="px-3 py-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                activeProps={{ className: "px-3 py-1.5 rounded-md bg-accent text-foreground" }}
              >
                Inventory
              </Link>
              <Link
                to="/sync"
                className="px-3 py-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                activeProps={{ className: "px-3 py-1.5 rounded-md bg-accent text-foreground" }}
              >
                Sync
              </Link>
            </nav>
          </div>
          <Button variant="ghost" size="sm" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}