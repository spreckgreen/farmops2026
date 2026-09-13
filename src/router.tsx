import type * as React from "react";
import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import {
  RouterContextGuard,
  assertRouterUsable,
} from "./components/router-context-guard";

const PRELOAD_RELOAD_KEY = "farmops:vite-preload-reload";

// A browser tab left open across a deployment can retain the old route manifest.
// Its next lazy-route navigation then requests a removed hashed chunk and receives
// a 404. Vite emits this event before surfacing the failure; reload once so the tab
// receives the current HTML/manifest. The timestamp prevents a broken deployment
// from producing an infinite reload loop.
if (typeof window !== "undefined") {
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    const lastReload = Number(window.sessionStorage.getItem(PRELOAD_RELOAD_KEY) ?? "0");
    if (Date.now() - lastReload < 15_000) return;
    window.sessionStorage.setItem(PRELOAD_RELOAD_KEY, String(Date.now()));
    window.location.reload();
  });
}

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    // Renders outside the router context provider, so it can catch the
    // "Cannot read properties of null (reading 'routesById')" crash that
    // happens when a stale module cache loads a second router copy.
    Wrap: ({ children }: { children: React.ReactNode }) => (
      <RouterContextGuard>{children}</RouterContextGuard>
    ),

  });

  try {
    assertRouterUsable(router);
  } catch (error) {
    console.error("[router] created router looks unusable:", error);
  }

  return router;
};
