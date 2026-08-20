import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

/**
 * Canonical slug reference for a task, rendered exactly as it should be typed
 * in a daily note (`#task/replace-hydraulic-filter`) with one-click copy.
 */
export function SlugChip({
  slug,
  className = "",
  prefix = "#task/",
  size = "sm",
}: {
  slug: string;
  className?: string;
  prefix?: string;
  size?: "sm" | "xs";
}) {
  const [copied, setCopied] = useState(false);
  const text = `${prefix}${slug}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(`Copied ${text}`);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Clipboard unavailable — select and copy manually");
    }
  };

  const textSize = size === "xs" ? "text-[10px]" : "text-xs";

  return (
    <button
      type="button"
      onClick={copy}
      title={`Copy ${text} — paste into a daily note to log against this task`}
      className={`inline-flex items-center gap-1 font-mono ${textSize} text-muted-foreground hover:text-foreground rounded px-1 -mx-1 hover:bg-accent/60 transition-colors max-w-full ${className}`}
    >
      <span className="truncate">{text}</span>
      {copied ? (
        <Check className="h-3 w-3 shrink-0 text-primary" aria-hidden />
      ) : (
        <Copy className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
      )}
      <span className="sr-only">Copy canonical slug</span>
    </button>
  );
}
