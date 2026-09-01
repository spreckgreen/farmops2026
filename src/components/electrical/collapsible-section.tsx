// Presentation-only wrapper: lets long QA / validation report sections collapse
// so a reader can hide areas they are not focusing on. No data behaviour here.
import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function CollapsibleSection({
  title,
  subtitle,
  badges,
  defaultOpen = false,
  children,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  badges?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className={className}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-2 px-6 py-3 text-left"
      >
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open ? "" : "-rotate-90",
          )}
        />
        <span className="text-base font-semibold">{title}</span>
        {badges}
        {subtitle ? (
          <span className="w-full pl-6 text-sm text-muted-foreground">{subtitle}</span>
        ) : null}
      </button>
      {open ? <CardContent className="pt-0">{children}</CardContent> : null}
    </Card>
  );
}

/**
 * Same collapsing affordance for children that already render their own Card,
 * so the sections do not end up double-framed.
 */
export function CollapsibleGroup({
  title,
  defaultOpen = false,
  children,
}: {
  title: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm font-medium"
      >
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open ? "" : "-rotate-90",
          )}
        />
        {title}
      </button>
      {open ? <div className="space-y-3 border-t border-border p-3">{children}</div> : null}
    </div>
  );
}
