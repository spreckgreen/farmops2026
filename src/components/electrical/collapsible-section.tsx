// Presentation-only wrapper: lets long QA / validation report sections collapse
// so a reader can hide areas they are not focusing on. No data behaviour here.
//
// Open/closed state persists per section in localStorage so a reader is not
// forced to re-collapse the same walls of data on every visit. State is read
// after mount (never in a useState initializer) so SSR markup and the first
// client render agree.
import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const PREFIX = "farmops.collapsible.";

/**
 * Stable storage key: explicit key wins, otherwise a plain-text title with all
 * numbers normalised, so a title like "Panels (12)" keeps the same key when the
 * count changes to 13. Non-text titles simply do not persist.
 */
function keyOf(storageKey: string | undefined, title: ReactNode): string | null {
  if (storageKey) return PREFIX + storageKey;
  if (typeof title !== "string" || !title.trim()) return null;
  return PREFIX + title.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
}

export function useCollapsibleState(
  storageKey: string | undefined,
  title: ReactNode,
  defaultOpen: boolean,
): [boolean, (next: boolean) => void] {
  const [open, setOpen] = useState(defaultOpen);
  const key = keyOf(storageKey, title);

  useEffect(() => {
    if (!key) return;
    try {
      const saved = window.localStorage.getItem(key);
      if (saved === "1" || saved === "0") setOpen(saved === "1");
    } catch {
      // Storage unavailable (private mode); fall back to the default.
    }
  }, [key]);

  const apply = (next: boolean) => {
    setOpen(next);
    if (!key) return;
    try {
      window.localStorage.setItem(key, next ? "1" : "0");
    } catch {
      // Ignore: persistence is a convenience, not a requirement.
    }
  };

  return [open, apply];
}

export function CollapsibleSection({
  title,
  subtitle,
  badges,
  defaultOpen = false,
  storageKey,
  children,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  badges?: ReactNode;
  defaultOpen?: boolean;
  /** Explicit persistence key; needed when the title is not plain text. */
  storageKey?: string;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useCollapsibleState(storageKey, title, defaultOpen);
  return (
    <Card className={className}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
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
  storageKey,
  children,
}: {
  title: ReactNode;
  defaultOpen?: boolean;
  storageKey?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useCollapsibleState(storageKey, title, defaultOpen);
  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
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
