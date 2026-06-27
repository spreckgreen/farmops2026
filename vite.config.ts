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
  ...(lowMem
    ? {
        vite: {
          build: {
            minify: "esbuild" as const,
            sourcemap: false,
            // Skips the final gzip-size pass that briefly doubles RAM.
            reportCompressedSize: false,
          },
        },
      }
    : {}),
});
