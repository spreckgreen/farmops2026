// Presentation-only collapsible card whose open/closed state is remembered in
// localStorage, so a reader's chosen layout survives reloads and navigation.
import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const PREFIX = "farmops.section-open.v1:";
const SET_OPEN_EVENT = "farmops:set-section-open";

type SetOpenDetail = { keys: string[]; open: boolean };

function writeStored(key: string, open: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFIX + key, open ? "1" : "0");
  } catch {
    // storage unavailable — keep the in-memory state
  }
}

export function setPersistedSectionsOpen(keys: string[], open: boolean) {
  if (typeof window === "undefined") return;
  keys.forEach((key) => writeStored(key, open));
  window.dispatchEvent(
    new CustomEvent<SetOpenDetail>(SET_OPEN_EVENT, { detail: { keys, open } }),
  );
}

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
  useEffect(() => {
    const handleSetOpen = (event: Event) => {
      const detail = (event as CustomEvent<SetOpenDetail>).detail;
      if (detail?.keys.includes(key)) setOpen(detail.open);
    };
    window.addEventListener(SET_OPEN_EVENT, handleSetOpen);
    return () => window.removeEventListener(SET_OPEN_EVENT, handleSetOpen);
  }, [key]);

  const setPersistedOpen = (next: boolean) => {
    writeStored(key, next);
    setOpen(next);
  };
  const toggle = () => setPersistedOpen(!open);
  return { open, toggle, setOpen: setPersistedOpen };
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
