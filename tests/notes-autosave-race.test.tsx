import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Reproduces the "fast tab navigation race": user types in Today, navigates
 * away before the in-flight save lands, then comes right back. The component
 * must always render the latest saved markdown — never the stale pre-edit
 * value from the cached query.
 */

// ----- Fake backend with controllable save latency ------------------------

const { store, getDailyNoteImpl, saveDailyNoteImpl, listProjectsImpl } = vi.hoisted(() => {
  const store = {
    noteId: "note-1",
    date: "2026-06-15",
    markdown: "initial content",
    saveLatencyMs: 50,
    saveCalls: 0,
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
  return { store, getDailyNoteImpl, saveDailyNoteImpl, listProjectsImpl };
});

// ----- Mocks --------------------------------------------------------------

vi.mock("@/lib/log.functions", () => ({
  getDailyNote: getDailyNoteImpl,
  saveDailyNote: saveDailyNoteImpl,
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

// ----- Tests --------------------------------------------------------------

describe("Today autosave race", () => {
  beforeEach(() => {
    store.noteId = "note-1";
    store.date = "2026-06-15";
    store.markdown = "initial content";
    store.saveLatencyMs = 50;
    store.saveCalls = 0;
    store.fetchCalls = 0;
    getDailyNoteImpl.mockClear();
    saveDailyNoteImpl.mockClear();
  });

  it("flushes pending edits on unmount and a remount sees the newest content", async () => {
    const user = userEvent.setup();

    // First mount: load, edit, unmount before debounce fires.
    const first = renderNotePage();
    const textarea = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
    expect(textarea.value).toBe("initial content");

    await user.clear(textarea);
    await user.type(textarea, "edited on Today");
    expect(textarea.value).toBe("edited on Today");

    // Simulate the user leaving Today (e.g. navigating to Inventory) BEFORE
    // the 800ms debounce fires. The unmount-flush effect must await the save.
    first.unmount();

    // Drain the in-flight save the unmount flush kicked off.
    await act(async () => {
      await new Promise((r) => setTimeout(r, store.saveLatencyMs + 50));
    });

    expect(store.saveCalls).toBeGreaterThanOrEqual(1);
    expect(store.markdown).toBe("edited on Today");

    // Second mount: come straight back to Today. Refetch should now see the
    // saved content — never the original stale string.
    renderNotePage();
    const remounted = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
    expect(remounted.value).toBe("edited on Today");
  });

  it("debounced typing eventually persists without unmounting", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderNotePage();
      const textarea = (await screen.findByRole("textbox")) as HTMLTextAreaElement;

      await user.clear(textarea);
      await user.type(textarea, "live edit");

      // Advance past the 800ms debounce + save latency.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      expect(store.saveCalls).toBeGreaterThanOrEqual(1);
      expect(store.markdown).toBe("live edit");
    } finally {
      vi.useRealTimers();
    }
  });
});
