import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuickLog } from "./QuickLog";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function renderQuickLog() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <QuickLog babyName="Clement" />
    </QueryClientProvider>,
  );
}

describe("QuickLog", () => {
  it("logs a wet diaper in one tap", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 9,
          type: "diaper",
          at: "2026-08-12T01:00:00.000Z",
          title: "Diaper — wet",
          detail: "",
          meta: { kind: "wet" },
          user: { id: 1, displayName: "Calvin" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    renderQuickLog();
    await userEvent.click(screen.getByRole("button", { name: "💧 Wet diaper" }));

    await waitFor(() =>
      expect(screen.getByText("Wet diaper logged just now.")).toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/records",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"kind":"wet"'),
      }),
    );
  });
});
