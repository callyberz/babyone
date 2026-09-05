import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PendingInvite } from "../api";
import { InvitePanel } from "./InvitePanel";

const INVITE_ID = "a".repeat(43);
const EXPIRES_AT = "2026-08-16T10:00:00.000Z";

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const renderPanel = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <InvitePanel />
    </QueryClientProvider>,
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("InvitePanel", () => {
  it("lists secret-free pending invites and exposes an accessible revoke state", async () => {
    let invites: PendingInvite[] = [
      {
        id: INVITE_ID,
        createdAt: "2026-08-15T10:00:00.000Z",
        expiresAt: EXPIRES_AT,
        createdBy: { id: 1, displayName: "Admin" },
      },
    ];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (input === "/api/invites" && !init?.method) {
        return response({ invites });
      }
      if (
        input === `/api/invites/${INVITE_ID}` &&
        init?.method === "DELETE"
      ) {
        invites = [];
        return response({ ok: true });
      }
      return response({ error: "unexpected_request" }, 500);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPanel();
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: "Manage pending invites" }),
    );
    expect(await screen.findByText("Created by Admin")).toBeInTheDocument();
    expect(
      screen.getByRole("list", { name: "Pending caregiver invites" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/code=/)).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: /Revoke invite created by Admin, expiring/,
      }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Invite revoked.",
    );
    expect(await screen.findByText("No pending invites.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(`/api/invites/${INVITE_ID}`, {
      credentials: "include",
      method: "DELETE",
    });
  });

  it("preserves generated-link copy and clears the link when that invite is revoked", async () => {
    let invites: PendingInvite[] = [];
    const secretUrl = "https://babyone.test/signup?code=one-time-secret";
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (input === "/api/invites" && !init?.method) {
        return response({ invites });
      }
      if (input === "/api/invites" && init?.method === "POST") {
        invites = [
          {
            id: INVITE_ID,
            createdAt: "2026-08-15T10:00:00.000Z",
            expiresAt: EXPIRES_AT,
            createdBy: { id: 1, displayName: "Admin" },
          },
        ];
        return response({
          id: INVITE_ID,
          code: "one-time-secret",
          url: secretUrl,
          expiresAt: EXPIRES_AT,
        });
      }
      if (
        input === `/api/invites/${INVITE_ID}` &&
        init?.method === "DELETE"
      ) {
        invites = [];
        return response({ ok: true });
      }
      return response({ error: "unexpected_request" }, 500);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPanel();
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);

    await user.click(screen.getByRole("button", { name: "Invite caregiver" }));

    expect(await screen.findByText(secretUrl)).toBeInTheDocument();
    expect(await screen.findByText("Created by Admin")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Copy invite link" }),
    );
    expect(writeText).toHaveBeenCalledWith(secretUrl);
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: /Revoke invite created by Admin, expiring/,
      }),
    );
    await waitFor(() => expect(screen.queryByText(secretUrl)).not.toBeInTheDocument());
    expect(await screen.findByText("No pending invites.")).toBeInTheDocument();
  });

  it("reports clipboard failures without losing the generated invite", async () => {
    const secretUrl = "https://babyone.test/signup?code=one-time-secret";
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        if (input === "/api/invites" && init?.method === "POST") {
          return response({
            id: INVITE_ID,
            code: "one-time-secret",
            url: secretUrl,
            expiresAt: EXPIRES_AT,
          });
        }
        if (input === "/api/invites" && !init?.method) {
          return response({ invites: [] });
        }
        return response({ error: "unexpected_request" }, 500);
      }),
    );
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
      new Error("Permission denied"),
    );
    renderPanel();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Invite caregiver" }));
    await user.click(
      await screen.findByRole("button", { name: "Copy invite link" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not copy the invite link. Select and copy it manually.",
    );
    expect(screen.getByText(secretUrl)).toBeInTheDocument();
  });
});
