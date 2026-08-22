import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import {
  RouterContextGuard,
  assertRouterUsable,
} from "./components/router-context-guard";

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
