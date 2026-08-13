import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MobileAccountMenu } from "./Sidebar";

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
});
