// Planner sheet preview, usable from the task pages themselves.
//
// Access is decided on the server (administrators always; anyone else needs an
// explicit grant), so this button simply hides itself when the person is not
// allowed. The preview shows the sheet at true Letter paper size.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { taskPrintAccess } from "@/lib/task-print-access.functions";
import { todayDateString } from "@/lib/slug";
import {
  TASK_PRINT_TEMPLATES,
  getTemplate,
  renderTaskPrint,
  type PrintTask,
  type TemplateId,
} from "@/lib/task-print-templates";

/** Whether the signed-in person may open the planner sheets. */
export function usePlannerPrintAccess() {
  const fn = useServerFn(taskPrintAccess);
  return useQuery({
    queryKey: ["task-print-access"],
    queryFn: () => fn(),
    staleTime: 5 * 60 * 1000,
  });
}

export function PlannerPrintDialog({
  tasks,
  sheetTitle,
  sheetSubtitle,
  label = "Print planner sheet",
}: {
  tasks: PrintTask[];
  sheetTitle: string;
  sheetSubtitle?: string;
  label?: string;
}) {
  const access = usePlannerPrintAccess();
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState<TemplateId>("work");
  const template = getTemplate(templateId)!;
  const [blankRows, setBlankRows] = useState<number>(template.defaultBlankRows);
  const [advanced, setAdvanced] = useState(false);
  const today = todayDateString();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [title, setTitle] = useState(sheetTitle);
  const [subtitle, setSubtitle] = useState(sheetSubtitle ?? `Printed ${today}`);
  const [motto, setMotto] = useState("CURE · CELLAR · SEED · STOCK · KEEP");

  const html = useMemo(() => {
    try {
      return renderTaskPrint(templateId, tasks, { title, subtitle, motto, blankRows, month });
    } catch (e) {
      return `<p>${e instanceof Error ? e.message : "Preview failed"}</p>`;
    }
  }, [templateId, tasks, title, subtitle, motto, blankRows, month]);

  if (!access.data?.allowed) return null;

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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-xs font-mono">
          <Printer className="h-3.5 w-3.5 mr-1.5" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle>Planner sheet preview</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <div className="space-y-3 max-h-[70vh] overflow-auto pr-1">
            <div className="space-y-2">
              {TASK_PRINT_TEMPLATES.map((t) => (
                <label
                  key={t.id}
                  className="flex gap-2 text-sm items-start border border-border rounded p-2 cursor-pointer hover:bg-accent"
                >
                  <input
                    type="radio"
                    name="planner-template"
                    className="mt-1"
                    checked={templateId === t.id}
                    onChange={() => selectTemplate(t.id)}
                  />
                  <span>
                    <span className="font-medium">{t.name}</span>
                    <span className="block text-xs text-muted-foreground">{t.description}</span>
                    <span className="block text-[10px] uppercase tracking-wider text-muted-foreground/70">
                      {t.orientation}
                      {t.usesTasks ? " · uses this list" : " · blank rows only"}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            <Button variant="ghost" size="sm" onClick={() => setAdvanced((v) => !v)}>
              {advanced ? "Hide advanced print options" : "Advanced print options"}
            </Button>

            {advanced ? (
              <div className="space-y-2">
                <div className="space-y-1">
                  <Label htmlFor="pp-title">Heading</Label>
                  <Input id="pp-title" value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pp-sub">Sub-line</Label>
                  <Input
                    id="pp-sub"
                    value={subtitle}
                    onChange={(e) => setSubtitle(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pp-motto">Footer line</Label>
                  <Input id="pp-motto" value={motto} onChange={(e) => setMotto(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pp-blank">Blank rows</Label>
                  <Input
                    id="pp-blank"
                    type="number"
                    min={0}
                    max={60}
                    value={blankRows}
                    onChange={(e) =>
                      setBlankRows(Math.max(0, Math.min(60, Number(e.target.value) || 0)))
                    }
                  />
                </div>
                {templateId === "grid" ? (
                  <div className="space-y-1">
                    <Label htmlFor="pp-month">Month</Label>
                    <Input
                      id="pp-month"
                      type="month"
                      value={month}
                      onChange={(e) => setMonth(e.target.value)}
                    />
                  </div>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {access.data.isAdmin
                    ? "You have these options as an administrator."
                    : "An administrator granted you these print options."}
                </p>
              </div>
            ) : null}

            <Button onClick={print} className="w-full">
              <Printer className="h-4 w-4 mr-2" />
              Print this sheet
            </Button>
          </div>

          <div className="overflow-auto rounded bg-muted/40 p-4 max-h-[70vh]">
            <div
              className="mx-auto bg-white shadow-lg ring-1 ring-border"
              style={{
                width: template.orientation === "landscape" ? "11in" : "8.5in",
                height: template.orientation === "landscape" ? "8.5in" : "11in",
                padding: "0.5in",
              }}
            >
              <iframe
                title="Planner print preview"
                srcDoc={html}
                className="h-full w-full border-0 bg-white"
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
