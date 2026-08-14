import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashScreen } from "./DashScreen";

beforeEach(() => localStorage.clear());

function renderDashboard(name: string) {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <DashScreen
        records={[]}
        baby={{
          name,
          birthdate: "2026-08-01",
          weightValue: 8,
          weightUnit: "lb",
        }}
        user={{
          id: 7,
          email: "caregiver@example.com",
          displayName: "Caregiver",
          isAdmin: false,
        }}
        setView={vi.fn()}
        onEditBaby={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe("DashScreen personalization", () => {
  it("uses the saved baby name in the handoff dashboard", async () => {
    renderDashboard("Maya");

    expect(
      screen.getByText("Here is what caregivers have recorded for Maya today."),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Maya" })).toBeInTheDocument();
    await waitFor(() =>
      expect(localStorage.getItem("babyone.handoff.7")).toBeTruthy(),
    );
  });

  it("uses a natural fallback when the profile name is blank", () => {
    renderDashboard("   ");
    expect(
      screen.getByText(
        "Here is what caregivers have recorded for your baby today.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "your baby" }),
    ).toBeInTheDocument();
  });
});
