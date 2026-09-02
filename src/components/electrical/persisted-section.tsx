// Presentation-only collapsible card whose open/closed state is remembered in
// localStorage, so a reader's chosen layout survives reloads and navigation.
import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const PREFIX = "farmops.section-open.v1:";

function readStored(key: string): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    // storage unavailable — fall back to the default
  }
  return null;
}

export function usePersistedOpen(key: string, defaultOpen: boolean) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    const stored = readStored(key);
    setOpen(stored === null ? defaultOpen : stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(PREFIX + key, next ? "1" : "0");
      } catch {
        // ignore write failures
      }
      return next;
    });
  };
  return { open, toggle };
}

export function PersistedSection({
  storageKey,
  title,
  badges,
  defaultOpen = false,
  children,
  className,
}: {
  storageKey: string;
  title: ReactNode;
  badges?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const { open, toggle } = usePersistedOpen(storageKey, defaultOpen);
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            {title}
            {badges}
          </CardTitle>
          {open ? (
            <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
        </button>
      </CardHeader>
      {open ? <CardContent>{children}</CardContent> : null}
    </Card>
  );
}
