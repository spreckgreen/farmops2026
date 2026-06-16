import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, Globe, Monitor, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

// Lovable doesn't expose publish state to the running app, so we infer from
// `window.location.host`:
//   * id-preview--<uuid>.lovable.app  → preview (not published)
//   * <slug>.lovable.app              → published Lovable URL
//   * anything else                   → custom domain (assumed published)
//   * localhost / 127.0.0.1 / *.local → local dev
type Env =
  | { kind: "preview"; host: string; previewId: string }
  | { kind: "published-lovable"; host: string; slug: string }
  | { kind: "custom-domain"; host: string }
  | { kind: "local"; host: string }
  | { kind: "unknown"; host: string };

function classify(host: string): Env {
  const lower = host.toLowerCase();
  if (
    lower === "localhost" ||
    lower.startsWith("localhost:") ||
    lower.startsWith("127.0.0.1") ||
    lower.endsWith(".local")
  ) {
    return { kind: "local", host };
  }
  if (lower.endsWith(".lovable.app")) {
    const sub = lower.slice(0, -".lovable.app".length);
    if (sub.startsWith("id-preview--")) {
      return { kind: "preview", host, previewId: sub.replace(/^id-preview--/, "") };
    }
    return { kind: "published-lovable", host, slug: sub };
  }
  if (!lower) return { kind: "unknown", host };
  return { kind: "custom-domain", host };
}

export function PublishStatusPanel() {
  const [env, setEnv] = useState<Env | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setEnv(classify(window.location.host));

    // Capture window-level errors that fired after mount so users can see
    // runtime problems on the published site without opening devtools.
    const onError = (e: ErrorEvent) =>
      setErrors((p) => [...p, `${e.message} (${e.filename}:${e.lineno})`].slice(-5));
    const onRejection = (e: PromiseRejectionEvent) =>
      setErrors((p) => [...p, `Unhandled rejection: ${String(e.reason)}`].slice(-5));
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  if (!env) {
    return (
      <div className="rounded-lg border border-border bg-card/30 p-4 text-sm text-muted-foreground">
        Checking publish status…
      </div>
    );
  }

  const isPublished = env.kind === "published-lovable" || env.kind === "custom-domain";
  const publishedUrl = isPublished ? `https://${env.host}` : null;
  const label =
    env.kind === "preview"
      ? "Preview (not yet published)"
      : env.kind === "published-lovable"
      ? "Published on Lovable"
      : env.kind === "custom-domain"
      ? "Published on custom domain"
      : env.kind === "local"
      ? "Local development"
      : "Unknown environment";

  const Icon = isPublished ? CheckCircle2 : env.kind === "preview" ? Monitor : Globe;
  const tone = isPublished
    ? "text-emerald-500"
    : env.kind === "preview"
    ? "text-amber-500"
    : "text-muted-foreground";

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Copy failed");
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card/30 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${tone}`} />
        <div className="font-medium">{label}</div>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Status</dt>
        <dd>{isPublished ? "Published" : env.kind === "preview" ? "Preview only" : "Not deployed"}</dd>

        <dt className="text-muted-foreground">Host</dt>
        <dd className="font-mono text-xs break-all">{env.host}</dd>

        <dt className="text-muted-foreground">Published URL</dt>
        <dd>
          {publishedUrl ? (
            <span className="inline-flex items-center gap-2">
              <a
                href={publishedUrl}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 break-all"
              >
                {publishedUrl}
              </a>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2"
                onClick={() => copy(publishedUrl)}
              >
                <Copy className="h-3 w-3" />
              </Button>
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </dd>

        {env.kind === "preview" && (
          <>
            <dt className="text-muted-foreground">Preview ID</dt>
            <dd className="font-mono text-xs break-all">{env.previewId}</dd>
          </>
        )}
      </dl>

      <div className="space-y-1">
        <div className="flex items-center gap-2 text-sm font-medium">
          <AlertTriangle
            className={`h-4 w-4 ${errors.length ? "text-destructive" : "text-muted-foreground"}`}
          />
          Publish / runtime errors
        </div>
        {errors.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            None captured this session. Lovable doesn't expose publish-pipeline errors to the
            running app — check the Publish dialog in the editor for build failures. Runtime
            errors raised in this tab will appear here.
          </p>
        ) : (
          <ul className="text-xs font-mono space-y-1 max-h-32 overflow-auto">
            {errors.map((e, i) => (
              <li key={i} className="text-destructive break-all">
                {e}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
