import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileAccountMenu } from "./Sidebar";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderMenu(
  overrides: Partial<React.ComponentProps<typeof MobileAccountMenu>> = {},
) {
  const props: React.ComponentProps<typeof MobileAccountMenu> = {
    theme: "light",
    setTheme: vi.fn(),
    baby: {
      name: "Clement",
      birthdate: "2026-08-09",
      weightValue: 7.4,
      weightUnit: "lb",
    },
    user: {
      id: 1,
      email: "calvin@example.com",
      displayName: "Calvin",
      isAdmin: true,
    },
    onEditBaby: vi.fn(),
    ...overrides,
  };
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MobileAccountMenu {...props} />
    </QueryClientProvider>,
  );
  return props;
}

describe("MobileAccountMenu", () => {
  it("makes desktop caregiver actions available in an accessible sheet", async () => {
    const setTheme = vi.fn();
    const onEditBaby = vi.fn();
    renderMenu({ setTheme, onEditBaby });
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: "Caregiver settings for Calvin" }),
    );

    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText(/signed in as/i)).toHaveTextContent("Calvin");
    expect(
      screen.getByRole("button", { name: "Invite caregiver" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Light mode" })).toHaveAttribute(
      "aria-checked",
      "false",
    );

    await user.click(screen.getByRole("switch", { name: "Light mode" }));
    expect(setTheme).toHaveBeenCalledWith("dark");

    await user.click(screen.getByRole("button", { name: /Clement/i }));
    expect(onEditBaby).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("dialog", { name: "Settings" }),
    ).not.toBeInTheDocument();
  });

  it("closes with Escape and restores focus to its trigger", async () => {
    renderMenu();
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", {
      name: "Caregiver settings for Calvin",
    });

    await user.click(trigger);
    await user.keyboard("{Escape}");

    await waitFor(() => expect(trigger).toHaveFocus());
    expect(
      screen.queryByRole("dialog", { name: "Settings" }),
    ).not.toBeInTheDocument();
  });

  it("exports household data for administrators", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-disposition": 'attachment; filename="household.json"',
        },
      }),
    );
    const createObjectURL = vi.fn().mockReturnValue("blob:household");
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", {
      createObjectURL,
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined,
    );
    renderMenu();
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: "Caregiver settings for Calvin" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Export household data" }),
    );

    expect(
      await screen.findByRole("status"),
    ).toHaveTextContent("Household data export downloaded.");
    expect(fetchMock).toHaveBeenCalledWith("/api/export", {
      credentials: "include",
    });
  });

  it("does not offer household export to caregivers", async () => {
    renderMenu({
      user: {
        id: 2,
        email: "caregiver@example.com",
        displayName: "Maya",
        isAdmin: false,
      },
    });
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: "Caregiver settings for Maya" }),
    );

    expect(
      screen.queryByRole("button", { name: "Export household data" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Invite caregiver" }),
    ).not.toBeInTheDocument();
  });

  it("reports an export failure and enables another attempt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "export unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderMenu();
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: "Caregiver settings for Calvin" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Export household data" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "export unavailable",
    );
    expect(
      screen.getByRole("button", { name: "Export household data" }),
    ).toBeEnabled();
  });
});
