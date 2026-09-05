import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { todayDateString } from "@/lib/slug";
import { ProfileGate } from "@/components/profile-gate";
import { useCurrentProfile } from "@/hooks/use-current-profile";
import { useAddon } from "@/hooks/use-addon";
import { isElectricianScoped } from "@/lib/electrical-access";
import { ShieldCheck, ChevronDown, Users, Trash2, Download, Upload, KeyRound, RefreshCw, Server, AlertTriangle, PackagePlus, CreditCard } from "lucide-react";

export function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const today = todayDateString();
  const profile = useCurrentProfile();
  const electrical = useAddon("electrical");
  const electricalReadOnly = useAddon("electrical_readonly");
  const roles = profile.data?.roles ?? [];
  // An electrician is scoped to the Electrical area only: the rest of the farm
  // app (tasks, food, inventory, admin utilities) is not part of their job.
  const electricianOnly = isElectricianScoped(roles, profile.data?.isAdmin);
  const showElectrical = electrical.enabled || electricalReadOnly.enabled;

  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    router.navigate({ to: "/auth", replace: true });
  };

  const navItem =
    "shrink-0 px-2.5 py-2 rounded-md hover:bg-accent hover:text-accent-foreground text-muted-foreground transition-colors lg:px-3 lg:py-1.5";
  const navActive = { className: "shrink-0 px-2.5 py-2 rounded-md bg-accent text-accent-foreground lg:px-3 lg:py-1.5" };


  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const adminActive = pathname.startsWith("/admin");

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b border-border bg-card/70 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 py-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 lg:flex lg:h-14 lg:justify-between lg:gap-4 lg:py-0">
          <Link to="/" className="order-1 min-w-0 truncate font-bold tracking-tight lg:shrink-0">
            Bostead Farms
          </Link>
          <nav className="order-3 col-span-2 -mx-1 flex items-center gap-1 overflow-x-auto whitespace-nowrap px-1 pb-1 text-sm lg:order-2 lg:col-span-1 lg:mx-0 lg:flex-1 lg:overflow-visible lg:pb-0">


              {electricianOnly ? null : (
                <>
              <Link to="/food" className={navItem} activeProps={navActive}>
                Food
              </Link>
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
              <Link to="/inventory" className={navItem} activeProps={navActive}>
                Inventory
              </Link>
              <Link to="/maintenance" className={navItem} activeProps={navActive}>
                Maintenance
              </Link>
              <Link to="/procedures" className={navItem} activeProps={navActive}>
                Procedures
              </Link>
                </>
              )}
              {showElectrical && (
                <Link to="/electrical" className={navItem} activeProps={navActive}>
                  Electrical
                </Link>
              )}

            </nav>
          <div className="order-2 flex shrink-0 items-center gap-1 sm:gap-2 lg:order-3">

            {electricianOnly ? null : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={adminActive || pathname.startsWith("/vault") || pathname.startsWith("/sync") ? "secondary" : "ghost"}
                  size="sm"
                  className="gap-1"
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Admin
                  <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem asChild>
                  <Link to="/vault" className="flex items-center gap-2 cursor-pointer">
                    <KeyRound className="h-4 w-4" />
                    Vault
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/sync" className="flex items-center gap-2 cursor-pointer">
                    <RefreshCw className="h-4 w-4" />
                    Sync
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/settings/self-host" className="flex items-center gap-2 cursor-pointer">
                    <Server className="h-4 w-4" />
                    Self-host settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/settings/troubleshooting" className="flex items-center gap-2 cursor-pointer">
                    <AlertTriangle className="h-4 w-4" />
                    Troubleshooting
                  </Link>
                </DropdownMenuItem>

                {profile.data?.isAdmin && (
                  <>
                    <DropdownMenuItem asChild>
                      <Link to="/admin" className="flex items-center gap-2 cursor-pointer">
                        <ShieldCheck className="h-4 w-4" />
                        Admin dashboard
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to="/admin/users" className="flex items-center gap-2 cursor-pointer">
                        <Users className="h-4 w-4" />
                        User management
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to="/admin/addons" className="flex items-center gap-2 cursor-pointer">
                        <PackagePlus className="h-4 w-4" />
                        Add-ons
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to="/admin/subscriptions" className="flex items-center gap-2 cursor-pointer">
                        <CreditCard className="h-4 w-4" />
                        Subscriptions
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to="/admin/export" className="flex items-center gap-2 cursor-pointer">
                        <Download className="h-4 w-4" />
                        Export snapshot
                      </Link>

                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to="/admin/restore" className="flex items-center gap-2 cursor-pointer">
                        <Upload className="h-4 w-4" />
                        Restore backup
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to="/admin/reset" className="flex items-center gap-2 cursor-pointer">
                        <Trash2 className="h-4 w-4" />
                        Reset data
                      </Link>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            )}
            <Button variant="ghost" size="sm" onClick={signOut}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="flex-1">
        <ProfileGate>{children}</ProfileGate>
      </main>
    </div>
  );
}
