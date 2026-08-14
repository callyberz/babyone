import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { meKey } from "./useAuth";
import { ProfilePanel } from "./ProfilePanel";

afterEach(() => vi.unstubAllGlobals());

describe("ProfilePanel", () => {
  it("saves a caregiver display name and updates the signed-in user cache", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          user: {
            id: 4,
            email: "maya@example.com",
            displayName: "Maya Lee",
            isAdmin: false,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <ProfilePanel
          user={{
            id: 4,
            email: "maya@example.com",
            displayName: "Maya",
            isAdmin: false,
          }}
        />
      </QueryClientProvider>,
    );
    const actor = userEvent.setup();

    await actor.click(screen.getByRole("button", { name: "Edit my profile" }));
    const input = screen.getByRole("textbox", { name: "Display name" });
    await actor.clear(input);
    await actor.type(input, "Maya Lee");
    await actor.click(screen.getByRole("button", { name: "Save name" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Profile updated.",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/profile",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ displayName: "Maya Lee" }),
      }),
    );
    expect(queryClient.getQueryData(meKey)).toMatchObject({
      displayName: "Maya Lee",
    });
  });

  it("keeps a failed update open and retryable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        new Response(JSON.stringify({ error: "could_not_update" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <ProfilePanel
          user={{
            id: 4,
            email: "maya@example.com",
            displayName: "Maya",
            isAdmin: false,
          }}
        />
      </QueryClientProvider>,
    );
    const actor = userEvent.setup();
    await actor.click(screen.getByRole("button", { name: "Edit my profile" }));
    await actor.click(screen.getByRole("button", { name: "Save name" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could_not_update",
    );
    expect(screen.getByRole("button", { name: "Save name" })).toBeEnabled();
  });
});
