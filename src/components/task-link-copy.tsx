import { useState } from "react";
import { Check, Link2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * One-click "copy task link" — turns the canonical `#task/<slug>` reference into
 * a clickable, URL-friendly form for pasting into emails or TinyWiki notes.
 *
 * Formats (for slug `replace-hydraulic-filter`, title "Replace hydraulic filter"):
 *   rich     → clickable "#task/replace-hydraulic-filter" (HTML anchor + plain-text fallback)
 *   markdown → [#task/replace-hydraulic-filter](https://host/tasks/replace-hydraulic-filter)
 *   url      → https://host/tasks/replace-hydraulic-filter
 *   ref      → #task/replace-hydraulic-filter
 */
export function taskLinkFormats(slug: string, title?: string, origin?: string) {
  const base = origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  const ref = `#task/${slug}`;
  const url = `${base}/tasks/${slug}`;
  const label = title ? `${title} (${ref})` : ref;
  return {
    ref,
    url,
    markdown: `[${ref}](${url})`,
    wiki: `[[${title ?? slug}]]`,
    plain: `${label} — ${url}`,
    html: `<a href="${url}">${escapeHtml(label)}</a>`,
  };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function writeClipboard(text: string, html?: string) {
  try {
    if (html && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      return true;
    }
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
}

export function TaskLinkCopy({
  slug,
  title,
  size = "sm",
  className = "",
}: {
  slug: string;
  title?: string;
  size?: "sm" | "xs";
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const f = taskLinkFormats(slug, title);

  const copy = async (text: string, html: string | undefined, what: string) => {
    const ok = await writeClipboard(text, html);
    if (!ok) {
      toast.error("Clipboard unavailable — select and copy manually");
      return;
    }
    setCopied(true);
    toast.success(`Copied ${what}`, { description: text });
    setTimeout(() => setCopied(false), 1500);
  };

  const Icon = copied ? Check : Link2;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          title={`Copy a clickable link for ${f.ref}`}
          className={`h-6 gap-1 px-1.5 ${size === "xs" ? "text-[10px]" : "text-xs"} text-muted-foreground hover:text-foreground ${className}`}
        >
          <Icon className={`h-3 w-3 ${copied ? "text-primary" : "opacity-60"}`} aria-hidden />
          Copy link
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Copy <span className="font-mono">{f.ref}</span> as…
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => copy(f.plain, f.html, "clickable link (for email)")}>
          <div className="flex flex-col">
            <span>Clickable link</span>
            <span className="text-[10px] text-muted-foreground">Rich text for email — falls back to plain</span>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => copy(f.markdown, undefined, "markdown link")}>
          <div className="flex flex-col">
            <span>Markdown link</span>
            <span className="text-[10px] font-mono text-muted-foreground truncate">{f.markdown}</span>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => copy(f.url, undefined, "URL")}>
          <div className="flex flex-col">
            <span>Plain URL</span>
            <span className="text-[10px] font-mono text-muted-foreground truncate">{f.url}</span>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => copy(f.ref, undefined, f.ref)}>
          <div className="flex flex-col">
            <span>Note reference</span>
            <span className="text-[10px] font-mono text-muted-foreground">{f.ref}</span>
          </div>
        </DropdownMenuItem>
        {title ? (
          <DropdownMenuItem onSelect={() => copy(f.wiki, undefined, "wiki reference")}>
            <div className="flex flex-col">
              <span>TinyWiki reference</span>
              <span className="text-[10px] font-mono text-muted-foreground truncate">{f.wiki}</span>
            </div>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
