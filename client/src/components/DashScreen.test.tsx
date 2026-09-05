import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { RoutineRecord } from "../types";
import { buildHandoffSummary, DashScreen } from "./DashScreen";

const now = new Date(2026, 7, 15, 12, 0, 0);
const handoffSince = new Date(2026, 7, 15, 8, 0, 0);

const records: RoutineRecord[] = [
  {
    id: 3,
    type: "sleep",
    at: new Date(2026, 7, 15, 11, 0, 0).toISOString(),
    title: "Morning nap",
    detail: "Private sleep note",
    meta: { mins: 45, private: "do not share" },
    user: { id: 9, displayName: "Sam" },
  },
  {
    id: 2,
    type: "feed",
    at: new Date(2026, 7, 15, 9, 30, 0).toISOString(),
    title: "Bottle feed",
    detail: "Private feeding note",
    meta: { volume_oz: 4 },
    user: { id: 8, displayName: "Alex" },
  },
  {
    id: 1,
    type: "diaper",
    at: new Date(2026, 7, 15, 7, 30, 0).toISOString(),
    title: "Wet diaper",
    detail: "",
    meta: { kind: "wet" },
  },
];

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(now);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "clipboard");
  Reflect.deleteProperty(navigator, "share");
});

function renderDashboard({
  name = "Maya",
  dashboardRecords = [],
  openRecord = vi.fn(),
}: {
  name?: string;
  dashboardRecords?: RoutineRecord[];
  openRecord?: (record: RoutineRecord) => void;
} = {}) {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <DashScreen
        records={dashboardRecords}
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
        openRecord={openRecord}
      />
    </QueryClientProvider>,
  );
}

describe("DashScreen personalization and handoff state", () => {
  it("uses the saved baby name and preserves the caught-up empty state", () => {
    renderDashboard();

    expect(
      screen.getByText("Here is what caregivers have recorded for Maya today."),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Maya" })).toBeInTheDocument();
    expect(screen.getByText("You're caught up.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Copy handoff" }),
    ).not.toBeInTheDocument();
    expect(localStorage.getItem("babyone.handoff.7")).toBe(now.toISOString());
  });

  it("uses a natural fallback when the profile name is blank", () => {
    renderDashboard({ name: "   " });
    expect(
      screen.getByText(
        "Here is what caregivers have recorded for your baby today.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "your baby" }),
    ).toBeInTheDocument();
  });

  it("only reviews activity after the prior dashboard visit", () => {
    localStorage.setItem("babyone.handoff.7", handoffSince.toISOString());
    renderDashboard({ dashboardRecords: records });

    const handoff = screen.getByRole("region", {
      name: "Since you last checked",
    });
    expect(within(handoff).getByText("Morning nap")).toBeInTheDocument();
    expect(within(handoff).getByText("Bottle feed")).toBeInTheDocument();
    expect(within(handoff).queryByText("Wet diaper")).not.toBeInTheDocument();
  });
});

describe("caregiver handoff summary", () => {
  it("is chronological and includes only share-safe activity fields", () => {
    const summary = buildHandoffSummary({
      records: [records[0]!, records[1]!],
      babyName: "Maya",
      since: handoffSince.getTime(),
    });

    expect(summary).toContain("Maya caregiver handoff");
    expect(summary).toContain("2 new records");
    expect(summary).toContain("Feeding · Bottle feed · logged by Alex");
    expect(summary).toContain("Sleep · Morning nap · logged by Sam");
    expect(summary.indexOf("Bottle feed")).toBeLessThan(
      summary.indexOf("Morning nap"),
    );
    expect(summary).not.toContain("Private");
    expect(summary).not.toContain("do not share");
    expect(summary).not.toContain('"id"');
  });

  it("copies the complete summary and reports success", async () => {
    localStorage.setItem("babyone.handoff.7", handoffSince.toISOString());
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderDashboard({ dashboardRecords: records });
    vi.useRealTimers();

    expect(
      screen.queryByRole("button", { name: "Share handoff" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy handoff" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(writeText.mock.calls[0]![0]).toContain(
      "Feeding · Bottle feed · logged by Alex",
    );
    expect(writeText.mock.calls[0]![0]).not.toContain("Private feeding note");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Handoff copied.",
    );
  });

  it("offers native sharing only when supported and reports completion", async () => {
    localStorage.setItem("babyone.handoff.7", handoffSince.toISOString());
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: share,
    });
    renderDashboard({ dashboardRecords: records });
    vi.useRealTimers();

    fireEvent.click(screen.getByRole("button", { name: "Share handoff" }));

    await waitFor(() => expect(share).toHaveBeenCalledOnce());
    expect(share).toHaveBeenCalledWith({
      title: "Maya caregiver handoff",
      text: expect.stringContaining("Sleep · Morning nap · logged by Sam"),
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Handoff shared.",
    );
  });
});

describe("dashboard activity rows", () => {
  it("opens a record from a keyboard-operable row", async () => {
    localStorage.setItem("babyone.handoff.7", handoffSince.toISOString());
    const openRecord = vi.fn();
    renderDashboard({ dashboardRecords: records, openRecord });
    vi.useRealTimers();
    const user = userEvent.setup();

    const row = screen.getAllByRole("button", {
      name: /Edit Morning nap, Sleep, .* logged by Sam/,
    })[0]!;
    row.focus();
    await user.keyboard("{Enter}");

    expect(openRecord).toHaveBeenCalledWith(records[0]);
  });
});
