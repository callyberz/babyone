import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";

const user = {
  id: 1,
  email: "caregiver@example.com",
  displayName: "Caregiver",
  isAdmin: false,
};

function renderSidebar(babyName: string | null) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Sidebar
        view="chat"
        setView={vi.fn()}
        theme="light"
        setTheme={vi.fn()}
        baby={
          babyName
            ? {
                name: babyName,
                birthdate: "2026-08-09",
                weightValue: null,
                weightUnit: "lb",
              }
            : null
        }
        user={user}
        onEditBaby={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe("Sidebar personalization", () => {
  it("uses the saved baby name and initial in the household identity", () => {
    renderSidebar("Riley");

    const identity = screen.getByLabelText("Riley's babyone routines");
    expect(within(identity).getByText("Riley")).toBeInTheDocument();
    expect(within(identity).getByText("R")).toBeInTheDocument();
    expect(within(identity).getByText("babyone · routines")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit Riley's profile" }),
    ).toBeInTheDocument();
  });

  it("uses neutral loading copy and disables profile editing before data arrives", () => {
    renderSidebar(null);

    expect(screen.getByLabelText("babyone routines")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Baby profile loading" }),
    ).toBeDisabled();
    expect(screen.queryByText("Clement")).not.toBeInTheDocument();
  });
});
