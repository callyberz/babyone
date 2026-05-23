import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { App } from "./App";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function Wrap({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("AuthGate", () => {
  it("shows LoginPage when /api/auth/me returns 401", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("", { status: 401 }) as Response,
    );
    render(
      <Wrap>
        <App />
      </Wrap>,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /sign in/i }),
      ).toBeInTheDocument(),
    );
  });
});
