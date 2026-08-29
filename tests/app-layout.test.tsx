import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

const { navigate, signOut, cancelQueries, clear } = vi.hoisted(() => ({
  navigate: vi.fn(),
  signOut: vi.fn().mockResolvedValue({ error: null }),
  cancelQueries: vi.fn().mockResolvedValue(undefined),
  clear: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, params, children, className }: any) => {
    const href =
      typeof to === "string"
        ? to.replace(/\$(\w+)/g, (_, k) => params?.[k] ?? "")
        : "#";
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  },
  useRouter: () => ({ navigate }),
  useRouterState: ({ select }: any) => select({ location: { pathname: "/notes/2026-06-28" } }),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => ({ cancelQueries, clear }),
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { signOut } },
}));

vi.mock("@/hooks/use-current-profile", () => ({
  useCurrentProfile: () => ({ data: { isAdmin: false }, isLoading: false }),
}));

vi.mock("@/components/profile-gate", () => ({
  ProfileGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppLayout } from "@/components/app-layout";

// AppLayout calls useAddon("electrical"), which uses useQuery and therefore
// needs a real QueryClient in context even though useQueryClient is mocked.
function renderLayout(children: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AppLayout>{children}</AppLayout>
    </QueryClientProvider>,
  );
}

describe("AppLayout top navigation", () => {
  beforeEach(() => {
    navigate.mockReset();
    signOut.mockClear();
    cancelQueries.mockClear();
    clear.mockClear();
  });

  it("renders all primary nav links", () => {
    render(
      <AppLayout>
        <div>child</div>
      </AppLayout>,
    );
    for (const label of [
      "Today",
      "Tasks",
      "Projects",
      "Reports",
      "Scheduled",
      "Inventory",
      "Maintenance",
      "Procedures",
      "Food",
      "Backlog",
    ]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("Maintenance and Inventory link to internal routes", () => {
    render(
      <AppLayout>
        <div />
      </AppLayout>,
    );
    expect(screen.getByRole("link", { name: "Maintenance" })).toHaveAttribute("href", "/maintenance");
    expect(screen.getByRole("link", { name: "Inventory" })).toHaveAttribute("href", "/inventory");
  });

  it("places Maintenance after Inventory in the primary nav", () => {
    render(
      <AppLayout>
        <div />
      </AppLayout>,
    );
    const labels = screen.getAllByRole("link").map((link) => link.textContent?.trim());
    expect(labels.indexOf("Inventory")).toBeLessThan(labels.indexOf("Maintenance"));
  });

  it("Today link points at /notes/<today>", () => {
    render(
      <AppLayout>
        <div />
      </AppLayout>,
    );
    const link = screen.getByRole("link", { name: "Today" });
    expect(link.getAttribute("href")).toMatch(/\/notes\/\d{4}-\d{2}-\d{2}/);
  });

  it("Sign out calls supabase signOut then navigates to /auth", async () => {
    render(
      <AppLayout>
        <div />
      </AppLayout>,
    );
    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));
    expect(cancelQueries).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledOnce();
    expect(signOut).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith({ to: "/auth", replace: true });
    expect(cancelQueries.mock.invocationCallOrder[0]).toBeLessThan(signOut.mock.invocationCallOrder[0]);
    expect(clear.mock.invocationCallOrder[0]).toBeLessThan(signOut.mock.invocationCallOrder[0]);
  });

  it("renders children inside main", () => {
    render(
      <AppLayout>
        <div data-testid="child">hello</div>
      </AppLayout>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });
});
