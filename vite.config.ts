// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Allow overriding the nitro preset via env (e.g. NITRO_PRESET=node-server for Docker).
// Outside Lovable's build environment, Nitro otherwise writes to `.output/` by default.
// Keep Docker builds deterministic by pinning the output layout to `dist/`.
const nitroPreset = process.env.NITRO_PRESET;

// Low-memory build path: trims peak Vite/Rollup RAM by ~30-40% so the
// container build fits on 4 GB hosts. Toggled via BUILD_LOW_MEM=1 (set in
// Dockerfile); never on in local dev unless explicitly requested.
const lowMem = process.env.BUILD_LOW_MEM === "1";

const lowMemoryGcPlugin = {
  name: "farmops-low-memory-gc",
  enforce: "post" as const,
  closeBundle() {
    const runtime = globalThis as typeof globalThis & { gc?: () => void };
    if (typeof runtime.gc === "function") {
      runtime.gc();
      console.log("[low-memory] released completed Vite environment before next build phase");
    }
  },
};

// Every module that must resolve to exactly ONE copy in the bundle. Two copies of
// @tanstack/react-router (or its core/store deps) means two React contexts: the
// provider writes to one, <Matches /> reads the other, and the app crashes with
// "Cannot read properties of null (reading 'routesById')".
const dedupe = [
  "react",
  "react-dom",
  "@tanstack/react-router",
  "@tanstack/router-core",
  "@tanstack/history",
  "@tanstack/react-store",
  "@tanstack/store",
  "@tanstack/react-start",
  "@tanstack/react-start-client",
  "@tanstack/start-client-core",
  "@tanstack/react-query",
  "@tanstack/query-core",
];

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  ...(nitroPreset
    ? {
        nitro: {
          preset: nitroPreset,
          output: {
            dir: "dist",
            serverDir: "dist/server",
            publicDir: "dist/client",
          },
        },
      }
    : {}),
  vite: {
    ...(lowMem ? { plugins: [lowMemoryGcPlugin] } : {}),
    resolve: {
      // Belt-and-braces on top of the preset's dedupe: forces a single copy of
      // the router in both the client and the SSR/worker bundle.
      dedupe,
    },
    optimizeDeps: {
      // Pre-bundle the router as one unit so dev never serves a second
      // `?v=<hash>` copy alongside a fresh build.
      include: [
        "@tanstack/react-router",
        "@tanstack/router-core",
        "@tanstack/react-store",
      ],
    },
    ...(lowMem
      ? {
          build: {
            minify: "esbuild" as const,
            sourcemap: false,
            // Skips the final gzip-size pass that briefly doubles RAM.
            reportCompressedSize: false,
          },
          // The Nitro/SSR server bundle is never shipped to browsers, so
          // minifying it only burns native memory during the phase that
          // previously pushed an 8 GB host into the OOM killer.
          environments: {
            ssr: { build: { minify: false as const, sourcemap: false } },
          },
        }
      : {}),

  },
});

