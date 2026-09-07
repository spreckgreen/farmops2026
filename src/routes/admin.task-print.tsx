// Admin-only task print templates: choose a task source and a template look,
// preview the sheet exactly as it will print, then send it to the printer.
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Printer, ShieldCheck } from "lucide-react";
import { AppLayout } from "@/components/app-layout";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { useCurrentProfile } from "@/hooks/use-current-profile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { listTasks, listBacklog, listScheduledTasks } from "@/lib/log.functions";
import { listUsers } from "@/lib/admin.functions";
import {
  taskPrintAccess,
  listTaskPrintGrants,
  setTaskPrintGrant,
} from "@/lib/task-print-access.functions";
import { todayDateString } from "@/lib/slug";
import {
  TASK_PRINT_TEMPLATES,
  getTemplate,
  renderTaskPrint,
  type PrintTask,
  type TemplateId,
} from "@/lib/task-print-templates";

export const Route = createFileRoute("/admin/task-print")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({
    meta: [
      { title: "Task Print Templates — Bostead" },
      {
        name: "description",
        content:
          "Admin-only print templates for FarmOps tasks: work sheets, blank sheets, month grids, ledgers and records.",
      },
      { property: "og:title", content: "Task Print Templates — Bostead" },
      {
        property: "og:description",
        content: "Pick a template look and print FarmOps tasks as paper sheets.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TaskPrintPage,
});

type SourceId = "today" | "backlog" | "scheduled" | "none";

const SOURCES: { id: SourceId; label: string }[] = [
  { id: "today", label: "Today's tasks" },
  { id: "backlog", label: "Backlog" },
  { id: "scheduled", label: "Scheduled & recurring" },
  { id: "none", label: "No tasks (blank sheet)" },
];

function currentMonth(): string {
  return todayDateString().slice(0, 7);
}

function TaskPrintPage() {
  const profile = useCurrentProfile();
  const isAdmin = profile.data?.isAdmin === true;
  const qc = useQueryClient();
  const accessFn = useServerFn(taskPrintAccess);
  const access = useQuery({ queryKey: ["task-print-access"], queryFn: () => accessFn() });
  const allowed = access.data?.allowed === true;

  const usersFn = useServerFn(listUsers);
  const grantsFn = useServerFn(listTaskPrintGrants);
  const setGrantFn = useServerFn(setTaskPrintGrant);
  const users = useQuery({ queryKey: ["admin-users"], enabled: isAdmin, queryFn: () => usersFn() });
  const grants = useQuery({
    queryKey: ["task-print-grants"],
    enabled: isAdmin,
    queryFn: () => grantsFn(),
  });
  const setGrant = useMutation({
    mutationFn: (v: { user_id: string; allowed: boolean }) => setGrantFn({ data: v }),
    onSuccess: (r) => {
      toast.success(r.allowed ? "Premium print granted." : "Premium print removed.");
      qc.invalidateQueries({ queryKey: ["task-print-grants"] });
      qc.invalidateQueries({ queryKey: ["task-print-access"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const todayFn = useServerFn(listTasks);
  const backlogFn = useServerFn(listBacklog);
  const scheduledFn = useServerFn(listScheduledTasks);

  const [source, setSource] = useState<SourceId>("today");
  const [templateId, setTemplateId] = useState<TemplateId>("work");
  const template = getTemplate(templateId)!;
  const [blankRows, setBlankRows] = useState<number>(template.defaultBlankRows);
  const [month, setMonth] = useState<string>(currentMonth());
  const today = todayDateString();
  const [title, setTitle] = useState("Bostead Farms · Tasks");
  const [subtitle, setSubtitle] = useState(`Printed ${today}`);
  const [motto, setMotto] = useState("CURE · CELLAR · SEED · STOCK · KEEP");

  const tasksQuery = useQuery({
    queryKey: ["task-print-source", source, today],
    enabled: allowed && source !== "none",
    queryFn: async (): Promise<PrintTask[]> => {
      if (source === "today") {
        const rows = await todayFn({ data: { date: today } });
        return rows.map((t) => ({
          title: t.title,
          slug: t.slug,
          status: t.status,
          recurrence: (t as { recurrence?: string | null }).recurrence ?? null,
          date: today,
        }));
      }
      if (source === "backlog") {
        const rows = await backlogFn({ data: { date: today } });
        return rows.map((t) => ({
          title: t.title,
          slug: t.slug,
          status: t.status,
          recurrence: (t as { recurrence?: string | null }).recurrence ?? null,
          date: null,
        }));
      }
      const rows = await scheduledFn({ data: { tag: null } });
      return rows.map((t) => ({
        title: t.title,
        slug: t.slug,
        status: t.status,
        recurrence: t.recurrence ?? null,
        date: t.start_at ? String(t.start_at).slice(0, 10) : null,
      }));
    },
  });

  const tasks = tasksQuery.data ?? [];

  const html = useMemo(() => {
    try {
      return renderTaskPrint(templateId, tasks, {
        title,
        subtitle,
        motto,
        blankRows,
        month,
      });
    } catch (e) {
      return `<p>${e instanceof Error ? e.message : "Preview failed"}</p>`;
    }
  }, [templateId, tasks, title, subtitle, motto, blankRows, month]);

  function selectTemplate(id: TemplateId) {
    setTemplateId(id);
    const t = getTemplate(id);
    if (t) setBlankRows(t.defaultBlankRows);
  }

  function print() {
    const win = window.open("", "_blank", "width=1000,height=1100");
    if (!win) {
      alert("Pop-ups were blocked. Please allow pop-ups to print.");
      return;
    }
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
  }

  if (profile.isLoading || access.isLoading) {
    return (
      <AppLayout>
        <div className="max-w-3xl mx-auto p-6 text-sm text-muted-foreground">Checking access…</div>
      </AppLayout>
    );
  }

  if (!allowed) {
    return (
      <AppLayout>
        <div className="max-w-2xl mx-auto p-6">
          <Alert>
            <ShieldCheck className="h-4 w-4" />
            <AlertTitle>Admins only</AlertTitle>
            <AlertDescription>
              Premium print — planner sheets, label sheets, grid sheets and publishing to Ghost
              and Obsidian — is for administrators by default. An administrator can grant it to you
              from this screen's advanced print options.
            </AlertDescription>
          </Alert>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Printer className="h-6 w-6" />
            Task print templates
          </h1>
          <p className="text-sm text-muted-foreground">
            Choose which tasks to print and which sheet look to print them on. Administrators by
            default; access can be granted to other people below.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Tasks to print</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {SOURCES.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="source"
                      checked={source === s.id}
                      onChange={() => setSource(s.id)}
                    />
                    {s.label}
                  </label>
                ))}
                <p className="text-xs text-muted-foreground pt-1">
                  {source === "none"
                    ? "Nothing printed — rows stay blank."
                    : tasksQuery.isLoading
                      ? "Loading tasks…"
                      : `${tasks.length} task(s) available`}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Template look</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {TASK_PRINT_TEMPLATES.map((t) => (
                  <label
                    key={t.id}
                    className="flex gap-2 text-sm items-start border border-border rounded p-2 cursor-pointer hover:bg-accent"
                  >
                    <input
                      type="radio"
                      name="template"
                      className="mt-1"
                      checked={templateId === t.id}
                      onChange={() => selectTemplate(t.id)}
                    />
                    <span>
                      <span className="font-medium">{t.name}</span>
                      <span className="block text-xs text-muted-foreground">{t.description}</span>
                      <span className="block text-[10px] uppercase tracking-wider text-muted-foreground/70">
                        {t.orientation}
                        {t.usesTasks ? " · uses your task list" : " · blank rows only"}
                      </span>
                    </span>
                  </label>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Sheet details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="tp-title">Heading</Label>
                  <Input id="tp-title" value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="tp-sub">Sub-line</Label>
                  <Input id="tp-sub" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="tp-motto">Footer line</Label>
                  <Input id="tp-motto" value={motto} onChange={(e) => setMotto(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="tp-blank">Blank rows</Label>
                  <Input
                    id="tp-blank"
                    type="number"
                    min={0}
                    max={60}
                    value={blankRows}
                    onChange={(e) => setBlankRows(Math.max(0, Math.min(60, Number(e.target.value) || 0)))}
                  />
                </div>
                {templateId === "grid" && (
                  <div className="space-y-1">
                    <Label htmlFor="tp-month">Month</Label>
                    <Input
                      id="tp-month"
                      type="month"
                      value={month}
                      onChange={(e) => setMonth(e.target.value)}
                    />
                  </div>
                )}
                <Button onClick={print} className="w-full">
                  <Printer className="h-4 w-4 mr-2" />
                  Print this sheet
                </Button>
              </CardContent>
            </Card>

            {isAdmin ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Who has premium print</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    One grant covers the whole premium print package: planner sheets, electrical
                    label sheets, grid sheets, and publishing out to Ghost and to an Obsidian
                    vault. Administrators always have it; add anyone else here.
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <ul className="space-y-1 text-sm">
                    {(grants.data ?? []).length === 0 ? (
                      <li className="text-xs text-muted-foreground">
                        No one outside the administrators yet.
                      </li>
                    ) : null}
                    {(grants.data ?? []).map((g) => (
                      <li key={g.user_id} className="flex items-center justify-between gap-2">
                        <span className="truncate">{g.display_name || g.email || g.user_id}</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setGrant.mutate({ user_id: g.user_id, allowed: false })}
                        >
                          Remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                  <div className="space-y-1">
                    <Label htmlFor="tp-grant">Grant to</Label>
                    <select
                      id="tp-grant"
                      className="w-full rounded border border-border bg-background p-2 text-sm"
                      value=""
                      onChange={(e) => {
                        if (e.target.value) {
                          setGrant.mutate({ user_id: e.target.value, allowed: true });
                        }
                      }}
                    >
                      <option value="">Choose a person…</option>
                      {(users.data ?? [])
                        .filter(
                          (u) => !(grants.data ?? []).some((g) => g.user_id === u.id),
                        )
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.display_name || u.email || u.id}
                          </option>
                        ))}
                    </select>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>

          <Card className="min-h-[600px]">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Preview · {template.name}</CardTitle>
              <p className="text-xs text-muted-foreground">
                Shown at true Letter paper size ({template.orientation}, 0.5 in margins) — what you
                see is the printed page.
              </p>
            </CardHeader>
            <CardContent>
              <div className="overflow-auto rounded bg-muted/40 p-4">
                <div
                  className="mx-auto bg-white shadow-lg ring-1 ring-border"
                  style={{
                    width: template.orientation === "landscape" ? "11in" : "8.5in",
                    height: template.orientation === "landscape" ? "8.5in" : "11in",
                    padding: "0.5in",
                  }}
                >
                  <iframe
                    title="Print preview"
                    srcDoc={html}
                    className="h-full w-full border-0 bg-white"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
