import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Search, CornerDownLeft } from "lucide-react";
import { searchTasks } from "@/lib/task-search.functions";

/**
 * Quick search box: type `#task/<slug>`, a slug fragment, `[[Task Name]]`,
 * or any part of a title and jump straight to the task page.
 * Enter goes to the highlighted match (exact slug match wins).
 */
export function TaskQuickSearch({ className = "" }: { className?: string }) {
  const navigate = useNavigate();
  const fn = useServerFn(searchTasks);
  const [value, setValue] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value.trim()), 150);
    return () => clearTimeout(t);
  }, [value]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const cleaned = debounced.replace(/^#task\//i, "").replace(/^\[\[/, "").replace(/\]\]$/, "").trim();

  const { data, isFetching } = useQuery({
    queryKey: ["task-quick-search", cleaned],
    queryFn: () => fn({ data: { query: cleaned } }),
    enabled: cleaned.length >= 2,
    staleTime: 15_000,
  });

  const matches = data?.matches ?? [];
  const exactSlug = data?.exact?.slug ?? null;
  const ordered = exactSlug
    ? [
        ...matches.filter((m) => m.slug === exactSlug),
        ...matches.filter((m) => m.slug !== exactSlug),
      ]
    : matches;

  useEffect(() => setActive(0), [cleaned]);

  const go = (slug: string) => {
    setOpen(false);
    setValue("");
    navigate({ to: "/tasks/$slug", params: { slug } });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, ordered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = ordered[active] ?? ordered[0];
      if (target) go(target.slug);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <div className="flex items-center gap-1.5 border border-border rounded px-2 py-1 bg-background focus-within:border-primary/60">
        <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden />
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="#task/slug or title…"
          aria-label="Quick search tasks by slug or title"
          className="w-52 bg-transparent outline-none text-xs font-mono placeholder:text-muted-foreground/70"
        />
      </div>
      {open && cleaned.length >= 2 && (
        <div className="absolute z-50 mt-1 w-80 max-w-[90vw] rounded-md border border-border bg-popover shadow-lg overflow-hidden">
          {isFetching && ordered.length === 0 && (
            <p className="px-3 py-2 text-xs font-mono text-muted-foreground">Searching…</p>
          )}
          {!isFetching && ordered.length === 0 && (
            <p className="px-3 py-2 text-xs font-mono text-muted-foreground">
              No task matches “{cleaned}”
            </p>
          )}
          <ul className="max-h-72 overflow-auto">
            {ordered.map((t, i) => (
              <li key={t.id}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(t.slug)}
                  className={`w-full text-left px-3 py-2 ${i === active ? "bg-accent" : ""}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm truncate">{t.title}</span>
                    {t.slug === exactSlug && (
                      <span className="text-[10px] font-mono uppercase text-primary shrink-0">exact</span>
                    )}
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-mono text-muted-foreground truncate">#task/{t.slug}</span>
                    <span className="text-[10px] font-mono text-muted-foreground shrink-0">{t.status}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {ordered.length > 0 && (
            <p className="flex items-center gap-1 border-t border-border px-3 py-1.5 text-[10px] font-mono text-muted-foreground">
              <CornerDownLeft className="h-3 w-3" aria-hidden /> Enter opens the highlighted task
            </p>
          )}
        </div>
      )}
    </div>
  );
}
