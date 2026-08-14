import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CaregiverAccessPanel } from "./CaregiverAccessPanel";

afterEach(() => vi.unstubAllGlobals());

describe("CaregiverAccessPanel", () => {
  it("lists caregivers and creates a copyable one-time reset link", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (input === "/api/caregivers") {
        return new Response(
          JSON.stringify({
            caregivers: [
              {
                id: 1,
                email: "admin@example.com",
                displayName: "Admin",
                isAdmin: true,
              },
              {
                id: 2,
                email: "maya@example.com",
                displayName: "Maya",
                isAdmin: false,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          url: "https://babyone.test/reset-password?code=secret",
          expiresAt: "2026-08-14T00:00:00.000Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <CaregiverAccessPanel currentUserId={1} />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);

    await user.click(screen.getByRole("button", { name: "Manage caregiver access" }));
    expect(await screen.findByText("Maya")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", {
        name: "Create password reset link for Maya",
      }),
    );

    expect(
      await screen.findByText("https://babyone.test/reset-password?code=secret"),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/caregivers/2/password-reset",
      expect.objectContaining({ method: "POST" }),
    );
    await user.click(screen.getByRole("button", { name: "Copy reset link" }));
    expect(writeText).toHaveBeenCalledWith(
      "https://babyone.test/reset-password?code=secret",
    );
  });
});
