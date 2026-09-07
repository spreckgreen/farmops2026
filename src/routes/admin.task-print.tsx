// Admin-only task print templates: choose a task source and a template look,
// preview the sheet exactly as it will print, then send it to the printer.
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
    enabled: isAdmin && source !== "none",
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

  if (profile.isLoading) {
    return (
      <AppLayout>
        <div className="max-w-3xl mx-auto p-6 text-sm text-muted-foreground">Checking access…</div>
      </AppLayout>
    );
  }

  if (!isAdmin) {
    return (
      <AppLayout>
        <div className="max-w-2xl mx-auto p-6">
          <Alert>
            <ShieldCheck className="h-4 w-4" />
            <AlertTitle>Admins only</AlertTitle>
            <AlertDescription>
              You need the <strong>admin</strong> role to use the task print templates.
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
            Choose which tasks to print and which sheet look to print them on. Admin only.
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
          </div>

          <Card className="min-h-[600px]">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Preview · {template.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <iframe
                title="Print preview"
                srcDoc={html}
                className="w-full h-[900px] border border-border rounded bg-white"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
