import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionPanel } from "./SessionPanel";

afterEach(() => vi.unstubAllGlobals());

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <SessionPanel />
    </QueryClientProvider>,
  );
}

describe("SessionPanel", () => {
  it("identifies the current device and confirms another device before revoking it", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method === "DELETE") {
        return new Response(JSON.stringify({ ok: true, current: false }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          sessions: [
            {
              id: "a".repeat(43),
              createdAt: "2026-08-13T12:00:00.000Z",
              expiresAt: "2026-09-12T12:00:00.000Z",
              userAgent:
                "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit Safari/605.1.15",
              current: true,
            },
            {
              id: "b".repeat(43),
              createdAt: "2026-08-12T12:00:00.000Z",
              expiresAt: "2026-09-11T12:00:00.000Z",
              userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/120.0",
              current: false,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPanel();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Signed-in devices" }));
    expect(await screen.findByText("Safari on macOS · This device")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Sign out Chrome on Android" }),
    );
    expect(screen.getByText("Sign out this device?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/auth/sessions/${"b".repeat(43)}`,
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("keeps a failed revoke visible and retryable", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method === "DELETE") {
        return new Response(JSON.stringify({ error: "could_not_revoke" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          sessions: [
            {
              id: "c".repeat(43),
              createdAt: "2026-08-12T12:00:00.000Z",
              expiresAt: "2026-09-11T12:00:00.000Z",
              userAgent: "Firefox/130.0 Windows",
              current: false,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPanel();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Signed-in devices" }));
    await user.click(
      await screen.findByRole("button", { name: "Sign out Firefox on Windows" }),
    );
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("could_not_revoke");
    expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
  });
});
