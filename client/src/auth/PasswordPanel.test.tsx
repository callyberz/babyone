import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PasswordPanel } from "./PasswordPanel";

afterEach(() => vi.unstubAllGlobals());

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <PasswordPanel />
    </QueryClientProvider>,
  );
}

async function fillForm(
  actor: ReturnType<typeof userEvent.setup>,
  current: string,
  next: string,
  confirmation: string,
) {
  await actor.type(screen.getByLabelText("Current password"), current);
  await actor.type(screen.getByLabelText("New password"), next);
  await actor.type(screen.getByLabelText("Confirm new password"), confirmation);
}

describe("PasswordPanel", () => {
  it("changes the password and reports revoked devices without signing out", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ ok: true, revokedSessions: 2 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderPanel();
    const actor = userEvent.setup();

    await actor.click(
      screen.getByRole("button", { name: "Change my password" }),
    );
    await fillForm(actor, "old-password", "new-password", "new-password");
    await actor.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Password changed. Signed out 2 other devices.",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/password",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          currentPassword: "old-password",
          newPassword: "new-password",
        }),
      }),
    );
  });

  it("validates confirmation locally without sending credentials", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    renderPanel();
    const actor = userEvent.setup();

    await actor.click(
      screen.getByRole("button", { name: "Change my password" }),
    );
    await fillForm(actor, "old-password", "new-password", "different-password");
    await actor.click(screen.getByRole("button", { name: "Change password" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "New passwords do not match.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps invalid-current-password errors open and retryable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        new Response(JSON.stringify({ error: "invalid_credentials" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    renderPanel();
    const actor = userEvent.setup();
    await actor.click(
      screen.getByRole("button", { name: "Change my password" }),
    );
    await fillForm(actor, "wrong-password", "new-password", "new-password");
    await actor.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Current password is incorrect.",
    );
    expect(screen.getByRole("button", { name: "Change password" })).toBeEnabled();
  });

  it("turns server throttling into actionable feedback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        new Response(JSON.stringify({ error: "too_many_attempts" }), {
          status: 429,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    renderPanel();
    const actor = userEvent.setup();
    await actor.click(
      screen.getByRole("button", { name: "Change my password" }),
    );
    await fillForm(actor, "wrong-password", "new-password", "new-password");
    await actor.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many attempts. Please wait and try again.",
    );
  });
});
