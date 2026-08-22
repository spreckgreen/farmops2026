/**
 * Runtime guard for the "Cannot read properties of null (reading 'routesById')"
 * crash.
 *
 * That error means React rendered TanStack Router's internal <Matches /> while
 * `useRouter()` returned null — i.e. the router context was missing. In practice
 * it happens when two copies of @tanstack/react-router are loaded at once (a
 * stale Vite dep-optimize cache such as `?v=8e1638a2` alongside a fresh build),
 * so the provider writes to one module's context and Matches reads another's.
 *
 * Nothing inside the router (route errorComponents, CatchBoundary) can catch it,
 * because the failure happens above the match tree. We therefore mount this
 * boundary through the router's `Wrap` option, which renders *outside* the
 * context provider, and show an actionable screen instead of a blank page.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

const RELOAD_FLAG = "lovable:router-context-auto-reloaded";

/** Heuristics for "the router context was missing", not a normal app error. */
export function isRouterContextError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!message) return false;
  return (
    /reading ['"]?routesById['"]?/.test(message) ||
    /routesById.*of null/.test(message) ||
    /useRouter.*(outside|inside).*(RouterProvider|router)/i.test(message) ||
    /invariant.*router.*context/i.test(message)
  );
}

/**
 * Sanity-check a router instance before it is handed to <RouterProvider />.
 * A healthy instance always exposes a populated `routesById` map.
 */
export function assertRouterUsable(router: unknown): void {
  const routesById = (router as { routesById?: Record<string, unknown> } | null)
    ?.routesById;
  if (!routesById || Object.keys(routesById).length === 0) {
    throw new Error(
      "Router context unavailable: routesById is empty. This usually means a stale module cache loaded a second copy of @tanstack/react-router.",
    );
  }
}

function hardReload() {
  try {
    window.sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch {
    /* storage may be unavailable */
  }
  const url = new URL(window.location.href);
  url.searchParams.set("_r", Date.now().toString(36));
  window.location.replace(url.toString());
}

function alreadyAutoReloaded(): boolean {
  try {
    const raw = window.sessionStorage.getItem(RELOAD_FLAG);
    if (!raw) return false;
    // Only treat a recent reload (2 min) as "we already tried this".
    return Date.now() - Number(raw) < 120_000;
  } catch {
    return true;
  }
}

function RouterContextErrorScreen({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground"
    >
      <div className="w-full max-w-lg space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm">
        <h1 className="text-lg font-semibold">This tab is out of date</h1>
        <p className="text-sm text-muted-foreground">
          The app couldn&apos;t start because the page is holding an old copy of the
          router from a previous build. Reloading fetches the current build and
          fixes it.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={hardReload}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Reload app
          </button>
          <a
            href="/"
            className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Go to start page
          </a>
        </div>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Technical details</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words">{message}</pre>
          <p className="mt-2">
            If it keeps happening, do a hard refresh (Cmd/Ctrl + Shift + R) to
            clear the cached modules.
          </p>
        </details>
      </div>
    </div>
  );
}

type Props = { children: ReactNode };
type State = { message: string | null };

export class RouterContextGuard extends Component<Props, State> {
  state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State | null {
    if (!isRouterContextError(error)) return null; // let other errors bubble
    return {
      message: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (!isRouterContextError(error)) throw error;
    console.error("[router-context-guard] router context missing", error, info);
    if (typeof window !== "undefined" && !alreadyAutoReloaded()) {
      hardReload();
    }
  }

  render() {
    if (this.state.message !== null) {
      return <RouterContextErrorScreen message={this.state.message} />;
    }
    return this.props.children;
  }
}
