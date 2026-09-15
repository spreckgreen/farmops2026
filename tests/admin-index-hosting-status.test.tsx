import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

const { selfHostState } = vi.hoisted(() => ({
  selfHostState: {
    isLoading: false,
    error: null as Error | null,
    data: null as any,
  },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (cfg: any) => ({ ...cfg }),
  Link: ({ to, children, className }: any) => (
    <a href={typeof to === "string" ? to : "#"} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/app-layout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/run-ai-test-card", () => ({
  RunAiTestCard: () => <div data-testid="ai-card" />,
}));

vi.mock("@/components/reseed-profile-card", () => ({
  ReseedProfileCard: () => <div data-testid="reseed-card" />,
}));

vi.mock("@/hooks/use-self-host-config", () => ({
  useSelfHostConfig: () => selfHostState,
}));

const { Route } = await import("@/routes/admin.index");
const AdminIndexPage = (Route as unknown as { component: React.FC }).component;

function setSelfHostState(next: {
  isLoading?: boolean;
  error?: Error | null;
  data?: any;
}) {
  selfHostState.isLoading = next.isLoading ?? false;
  selfHostState.error = next.error ?? null;
  selfHostState.data = next.data ?? null;
}

describe("admin index hosting and reseed status", () => {
  beforeEach(() => {
    setSelfHostState({ isLoading: false, error: null, data: null });
  });

  it("shows loading state while hosting status is loading", () => {
    setSelfHostState({ isLoading: true });
    render(<AdminIndexPage />);

    expect(screen.getByText(/Loading hosting status/i)).toBeInTheDocument();
  });

  it("shows error state when hosting status fails to load", () => {
    setSelfHostState({ error: new Error("boom") });
    render(<AdminIndexPage />);

    expect(screen.getByText(/Could not load hosting status: boom/i)).toBeInTheDocument();
  });

  it("shows ready cloud-synced reseed status", () => {
    setSelfHostState({
      data: {
        hostingModelLabel: "Cloud-synced",
        pendingDivergence: false,
        reseedReadiness: { ready: true, checks: [] },
        reseedWorkflowHint: "Dedicated cloud-synced reseed is available.",
      },
    });

    render(<AdminIndexPage />);

    expect(screen.getByText(/Current model:/i)).toBeInTheDocument();
    expect(screen.getAllByText("Cloud-synced").length).toBeGreaterThan(0);
    expect(screen.getByText(/No pending divergence reported/i)).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open cloud-synced reseed/i })).toHaveAttribute(
      "href",
      "/admin/reseed",
    );
  });

  it("shows blocked reseed state when divergence is pending", () => {
    setSelfHostState({
      data: {
        hostingModelLabel: "Isolated self-host",
        pendingDivergence: true,
        reseedReadiness: { ready: false, checks: [] },
        reseedWorkflowHint: "Switch to cloud-synced mode before reseed.",
      },
    });

    render(<AdminIndexPage />);

    expect(screen.getByText(/Pending divergence reported/i)).toBeInTheDocument();
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    const selfHostLinks = screen.getAllByRole("link", { name: /Self-host settings/i });
    expect(selfHostLinks.length).toBeGreaterThan(0);
    expect(selfHostLinks[0]).toHaveAttribute("href", "/settings/self-host");
  });
});
