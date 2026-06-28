import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

const { navigate, signOut, cancelQueries, clear, refetch, profileState } = vi.hoisted(() => ({
  navigate: vi.fn(),
  signOut: vi.fn().mockResolvedValue({ error: null }),
  cancelQueries: vi.fn().mockResolvedValue(undefined),
  clear: vi.fn(),
  refetch: vi.fn(),
  profileState: {
    data: {
      id: "u1",
      email: "user@example.com",
      display_name: null,
      status: "approved",
      roles: ["editor"],
      canEdit: true,
      isAdmin: false,
    },
    isLoading: false,
    error: null as Error | null,
  },
}));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ navigate }),
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
  useCurrentProfile: () => ({ ...profileState, refetch }),
}));

import { ProfileGate } from "@/components/profile-gate";

describe("ProfileGate auth states", () => {
  beforeEach(() => {
    navigate.mockReset();
    signOut.mockClear();
    cancelQueries.mockClear();
    clear.mockClear();
    refetch.mockClear();
    profileState.data = {
      id: "u1",
      email: "user@example.com",
      display_name: null,
      status: "approved",
      roles: ["editor"],
      canEdit: true,
      isAdmin: false,
    };
    profileState.isLoading = false;
    profileState.error = null;
  });

  it("renders protected children for an approved user", () => {
    render(
      <ProfileGate>
        <div>protected app</div>
      </ProfileGate>,
    );
    expect(screen.getByText("protected app")).toBeInTheDocument();
  });

  it("blocks pending users from protected content", () => {
    profileState.data = { ...profileState.data, status: "pending" };
    render(
      <ProfileGate>
        <div>protected app</div>
      </ProfileGate>,
    );
    expect(screen.getByRole("heading", { name: /waiting for approval/i })).toBeInTheDocument();
    expect(screen.queryByText("protected app")).not.toBeInTheDocument();
  });

  it("blocks rejected users from protected content", () => {
    profileState.data = { ...profileState.data, status: "rejected" };
    render(
      <ProfileGate>
        <div>protected app</div>
      </ProfileGate>,
    );
    expect(screen.getByRole("heading", { name: /access denied/i })).toBeInTheDocument();
    expect(screen.queryByText("protected app")).not.toBeInTheDocument();
  });

  it("clears cached protected data before signing out from a gate screen", async () => {
    profileState.data = { ...profileState.data, status: "pending" };
    render(
      <ProfileGate>
        <div>protected app</div>
      </ProfileGate>,
    );
    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));
    expect(cancelQueries).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledOnce();
    expect(signOut).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith({ to: "/auth", replace: true });
  });

  it("lets a profile load error retry without showing protected content", async () => {
    profileState.data = null as never;
    profileState.error = new Error("profile unavailable");
    render(
      <ProfileGate>
        <div>protected app</div>
      </ProfileGate>,
    );
    expect(screen.getByRole("heading", { name: /couldn't load your profile/i })).toBeInTheDocument();
    expect(screen.queryByText("protected app")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(refetch).toHaveBeenCalledOnce();
  });
});