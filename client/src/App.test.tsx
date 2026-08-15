import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { App } from "./App";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  localStorage.clear();
  window.history.replaceState({}, "", "/");
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

  it("updates every visible baby identity after the profile name is saved", async () => {
    const initialBaby = {
      name: "Clement",
      birthdate: "2026-08-09",
      weightValue: null,
      weightUnit: "lb",
    };
    fetchMock.mockImplementation(async (input, init) => {
      if (input === "/api/auth/me") {
        return new Response(
          JSON.stringify({
            user: {
              id: 1,
              email: "caregiver@example.com",
              displayName: "Caregiver",
              isAdmin: false,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (input === "/api/sync") {
        return new Response(
          JSON.stringify({
            full: true,
            cursor: 0,
            hasMore: false,
            records: [],
            messages: [],
            deletedRecordIds: [],
            deletedMessageIds: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (input === "/api/baby" && init?.method === "PUT") {
        return new Response(String(init.body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === "/api/baby") {
        return new Response(JSON.stringify(initialBaby), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === "/api/brief/today") {
        return new Response(JSON.stringify({ message: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    const app = render(
      <Wrap>
        <App />
      </Wrap>,
    );
    const user = userEvent.setup();

    expect(
      await screen.findByRole("heading", { name: "Chat about Clement" }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/Household synced/)).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Edit Clement's profile" }),
    );
    const name = screen.getByRole("textbox", { name: "Name" });
    await user.clear(name);
    await user.type(name, "Riley");
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    expect(
      await screen.findByRole("heading", { name: "Chat about Riley" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Riley's babyone routines")).toBeInTheDocument();
    expect(screen.getByLabelText("Message about Riley")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "How much sleep has Riley had today?",
      }),
    ).toBeInTheDocument();
    expect(document.title).toBe("Riley — babyone");
    app.unmount();
    expect(document.title).toBe("babyone — Baby Routines");
  });
});
