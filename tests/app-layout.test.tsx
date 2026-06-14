import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

const { navigate, signOut } = vi.hoisted(() => ({
  navigate: vi.fn(),
  signOut: vi.fn().mockResolvedValue({ error: null }),
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
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { signOut } },
}));

import { AppLayout } from "@/components/app-layout";

describe("AppLayout top navigation", () => {
  beforeEach(() => {
    navigate.mockReset();
    signOut.mockClear();
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
      "Summaries",
      "Maintenance",
      "Inventory",
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
    expect(signOut).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith({ to: "/auth" });
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
