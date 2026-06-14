import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

const navigate = vi.fn();
const getUser = vi.fn().mockResolvedValue({ data: { user: null }, error: null });
const signInWithPassword = vi
  .fn()
  .mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
const signUp = vi
  .fn()
  .mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (cfg: any) => cfg,
  useNavigate: () => navigate,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser, signInWithPassword, signUp } },
}));

vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

// Import after mocks so the component picks them up
const { Route } = await import("@/routes/auth");
const AuthPage = (Route as unknown as { component: React.FC }).component;

describe("Auth page", () => {
  beforeEach(() => {
    navigate.mockReset();
    getUser.mockClear();
    signInWithPassword.mockClear();
    signUp.mockClear();
    toastSuccess.mockClear();
    toastError.mockClear();
  });

  it("renders sign-in form by default", () => {
    render(<AuthPage />);
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it("toggles to sign-up mode", async () => {
    render(<AuthPage />);
    await userEvent.click(screen.getByRole("button", { name: /no account\? sign up/i }));
    expect(screen.getByRole("button", { name: /create account/i })).toBeInTheDocument();
  });

  it("submits sign-in with email/password", async () => {
    render(<AuthPage />);
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.co");
    await userEvent.type(screen.getByLabelText(/password/i), "secret123");
    await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "a@b.co",
      password: "secret123",
    });
    expect(navigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("submits sign-up with email/password and shows success toast", async () => {
    render(<AuthPage />);
    await userEvent.click(screen.getByRole("button", { name: /no account\? sign up/i }));
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.co");
    await userEvent.type(screen.getByLabelText(/password/i), "secret123");
    await userEvent.click(screen.getByRole("button", { name: /create account/i }));
    expect(signUp).toHaveBeenCalledOnce();
    const arg = signUp.mock.calls[0][0];
    expect(arg.email).toBe("a@b.co");
    expect(arg.password).toBe("secret123");
    expect(arg.options.emailRedirectTo).toBeTruthy();
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("shows error toast when sign-in fails", async () => {
    signInWithPassword.mockResolvedValueOnce({
      data: null,
      error: new Error("Invalid login credentials"),
    });
    render(<AuthPage />);
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.co");
    await userEvent.type(screen.getByLabelText(/password/i), "wrongpass");
    await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
    expect(toastError).toHaveBeenCalledWith("Invalid login credentials");
    expect(navigate).not.toHaveBeenCalled();
  });
});
