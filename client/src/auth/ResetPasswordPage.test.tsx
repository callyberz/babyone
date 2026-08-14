import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResetPasswordPage } from "./ResetPasswordPage";
import { meKey } from "./useAuth";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  window.history.pushState({}, "", "/reset-password?code=one-time-code");
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  window.history.pushState({}, "", "/");
});

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ResetPasswordPage />
    </QueryClientProvider>,
  );
  return queryClient;
}

describe("ResetPasswordPage", () => {
  it("requires matching passwords and signs in after a successful reset", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          user: {
            id: 2,
            email: "maya@example.com",
            displayName: "Maya",
            isAdmin: false,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const queryClient = renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("New password"), "new-password");
    await user.type(screen.getByLabelText("Confirm new password"), "different");
    expect(screen.getByRole("alert")).toHaveTextContent("Passwords do not match");
    expect(screen.getByRole("button", { name: "Reset password" })).toBeDisabled();

    await user.clear(screen.getByLabelText("Confirm new password"));
    await user.type(screen.getByLabelText("Confirm new password"), "new-password");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/reset-password", {
      credentials: "include",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: "one-time-code",
        password: "new-password",
      }),
    });
    expect(queryClient.getQueryData(meKey)).toMatchObject({ displayName: "Maya" });
  });

  it("explains an expired reset link", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_reset" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("New password"), "new-password");
    await user.type(screen.getByLabelText("Confirm new password"), "new-password");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "invalid or has expired",
    );
  });
});
