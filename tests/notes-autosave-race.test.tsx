import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Reproduces the "fast tab navigation race": user types in Today, navigates
 * away before the in-flight save lands, then comes right back. The component
 * must always render the latest saved markdown — never the stale pre-edit
 * value from the cached query.
 */

// ----- Fake backend with controllable save latency ------------------------

const { store, getDailyNoteImpl, saveDailyNoteImpl, commitDailyNoteImpl, refreshDailyNoteFromLogImpl, listProjectsImpl } = vi.hoisted(() => {
  const store = {
    noteId: "note-1",
    date: "2026-06-15",
    markdown: "initial content",
    saveLatencyMs: 50,
    saveCalls: 0,
    commitCalls: 0,
    fetchCalls: 0,
  };
  const getDailyNoteImpl = vi.fn(async () => {
    store.fetchCalls++;
    return {
      note: { id: store.noteId, date: store.date, markdown_content: store.markdown },
      tasks: [] as Array<{ id: string; slug: string; title: string; status: string }>,
    };
  });
  const saveDailyNoteImpl = vi.fn(
    async ({ data }: { data: { noteId: string; date: string; markdown: string } }) => {
      store.saveCalls++;
      await new Promise((r) => setTimeout(r, store.saveLatencyMs));
      store.markdown = data.markdown;
      return { saved: true, newEntries: 0 };
    },
  );
  const listProjectsImpl = vi.fn(async () => [] as Array<{ slug: string; name: string }>);
  const commitDailyNoteImpl = vi.fn(
    async ({ data }: { data: { noteId: string; date: string; markdown: string } }) => {
      store.commitCalls++;
      await new Promise((r) => setTimeout(r, store.saveLatencyMs));
      store.markdown = data.markdown;
      return { saved: true, newEntries: 0 };
    },
  );
  const refreshDailyNoteFromLogImpl = vi.fn(async () => ({
    markdown: store.markdown,
    restored: 0,
    preserved: 0,
    deduped: 0,
  }));
  return { store, getDailyNoteImpl, saveDailyNoteImpl, commitDailyNoteImpl, refreshDailyNoteFromLogImpl, listProjectsImpl };
});

// ----- Mocks --------------------------------------------------------------

vi.mock("@/lib/log.functions", () => ({
  getDailyNote: getDailyNoteImpl,
  saveDailyNote: saveDailyNoteImpl,
  commitDailyNote: commitDailyNoteImpl,
  refreshDailyNoteFromLog: refreshDailyNoteFromLogImpl,
  listProjects: listProjectsImpl,
}));

vi.mock("@/lib/auth-route", () => ({ requireAuthenticatedUser: () => ({}) }));

vi.mock("@/components/app-layout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@tanstack/react-start", () => ({
  // Identity passthrough: useServerFn(fn) returns the same callable.
  useServerFn: (fn: unknown) => fn,
  createMiddleware: () => ({
    server: (fn: unknown) => fn,
    client: (fn: unknown) => fn,
  }),
  createServerFn: () => ({
    middleware() {
      return this;
    },
    inputValidator() {
      return this;
    },
    handler(fn: unknown) {
      return fn;
    },
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: { component: React.FC }) => ({ options: opts }),
  useParams: () => ({ date: "2026-06-15" }),
  useNavigate: () => vi.fn(),
  Link: ({ children, to, params }: any) => {
    const href =
      typeof to === "string" ? to.replace(/\$(\w+)/g, (_, k) => params?.[k] ?? "") : "#";
    return <a href={href}>{children}</a>;
  },
}));

// Must import AFTER mocks so the module picks them up.
// eslint-disable-next-line import/first
import { Route as NoteRoute } from "@/routes/notes.$date";

const NotePage = (NoteRoute as unknown as { options: { component: React.FC } }).options.component;

function renderNotePage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <NotePage />
      </QueryClientProvider>,
    ),
  };
}

async function openMarkdownEditor() {
  await userClick(screen.getByRole("button", { name: /edit markdown/i }));
  return (await screen.findByRole("textbox")) as HTMLTextAreaElement;
}

async function userClick(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

// ----- Tests --------------------------------------------------------------

describe("Today autosave race", () => {
  beforeEach(() => {
    store.noteId = "note-1";
    store.date = "2026-06-15";
    store.markdown = "initial content";
    store.saveLatencyMs = 50;
    store.saveCalls = 0;
    store.commitCalls = 0;
    store.fetchCalls = 0;
    getDailyNoteImpl.mockClear();
    saveDailyNoteImpl.mockClear();
  });

  it("flushes pending edits on unmount and a remount sees the newest content", async () => {
    // First mount: load, edit, unmount before the 800ms debounce fires.
    const first = renderNotePage();
    const textarea = await openMarkdownEditor();
    await waitFor(() => expect(textarea.value).toBe("initial content"));

    fireEvent.change(textarea, { target: { value: "edited on Today" } });
    expect(textarea.value).toBe("edited on Today");

    // Simulate the user leaving Today (e.g. navigating to Inventory) BEFORE
    // the debounce fires. The unmount-flush effect must kick off the save.
    first.unmount();

    // Drain the in-flight save the unmount flush kicked off.
    await act(async () => {
      await new Promise((r) => setTimeout(r, store.saveLatencyMs + 100));
    });

    expect(store.commitCalls).toBeGreaterThanOrEqual(1);
    expect(store.markdown).toBe("edited on Today");

    // Second mount: come straight back to Today. Refetch must serve the
    // saved content — never the original stale string.
    renderNotePage();
    const remounted = await openMarkdownEditor();
    await waitFor(() => expect(remounted.value).toBe("edited on Today"));
  });

  it("debounced typing eventually persists without unmounting", async () => {
    renderNotePage();
    const textarea = await openMarkdownEditor();
    await waitFor(() => expect(textarea.value).toBe("initial content"));

    fireEvent.change(textarea, { target: { value: "live edit" } });

    // Wait past the 800ms debounce + save latency.
    await waitFor(
      () => {
        expect(store.saveCalls).toBeGreaterThanOrEqual(1);
        expect(store.markdown).toBe("live edit");
      },
      { timeout: 2000 },
    );
  });
});
