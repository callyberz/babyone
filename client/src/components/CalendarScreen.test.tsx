import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoutineRecord } from "../types";
import { CalendarScreen } from "./CalendarScreen";

const now = new Date(2026, 7, 15, 12, 0, 0);

function at(day: number, hour: number) {
  return new Date(2026, 7, day, hour, 0, 0).toISOString();
}

const records: RoutineRecord[] = [
  {
    id: 1,
    type: "sleep",
    at: at(15, 18),
    title: "Evening nap",
    detail: "In the crib",
    meta: { mins: 45 },
  },
  {
    id: 2,
    type: "feed",
    at: at(15, 8),
    title: "Morning bottle",
    detail: "",
    meta: { volume_oz: 4 },
  },
  {
    id: 3,
    type: "feed",
    at: at(10, 12),
    title: "Lunch bottle",
    detail: "",
    meta: { volume_oz: 3 },
  },
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});

afterEach(() => vi.useRealTimers());

describe("CalendarScreen", () => {
  it("names the baby in empty states", () => {
    render(
      <CalendarScreen records={[]} openRecord={vi.fn()} babyName="Riley" />,
    );

    expect(
      screen.getByText("No records logged for Riley this day."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No activity logged for Riley this month."),
    ).toBeInTheDocument();
  });

  it("exposes exact day summaries and selected/current state on date buttons", () => {
    render(<CalendarScreen records={records} openRecord={vi.fn()} />);

    const today = screen.getByRole("button", {
      name: /Saturday, August 15, 2026, today, 2 records, 1 Feeding, 1 Sleep, selected/,
    });
    expect(today).toHaveAttribute("aria-current", "date");
    expect(today).toHaveAttribute("aria-pressed", "true");
    expect(within(today).getByText("2 logs")).toBeInTheDocument();

    const earlierDay = screen.getByRole("button", {
      name: /Monday, August 10, 2026, 1 record, 1 Feeding/,
    });
    expect(earlierDay).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(earlierDay);
    expect(earlierDay).toHaveAttribute("aria-pressed", "true");
  });

  it("labels month navigation and keeps the selected day in the visible month", () => {
    render(<CalendarScreen records={records} openRecord={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: "Previous month" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));

    expect(
      screen.getByRole("heading", { name: "September 2026" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /Tuesday, September 1, 2026, 0 records, selected/,
      }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("summarizes the visible month with exact totals and its busiest day", () => {
    render(<CalendarScreen records={records} openRecord={vi.fn()} />);

    const overview = screen.getByRole("region", {
      name: "August 2026 overview",
    });
    expect(within(overview).getByText("3 records across 2 active days.")).toBeInTheDocument();
    expect(within(overview).getByText("Aug 15 · 2 records")).toBeInTheDocument();
    expect(within(overview).getByText("3")).toBeInTheDocument();
    expect(within(overview).getByText("2")).toBeInTheDocument();
  });

  it("sorts selected entries chronologically and opens them from the keyboard", async () => {
    const openRecord = vi.fn();
    render(<CalendarScreen records={records} openRecord={openRecord} />);
    vi.useRealTimers();
    const user = userEvent.setup();

    const entryButtons = screen.getAllByRole("button", { name: /^Edit / });
    expect(entryButtons.map((button) => button.textContent)).toEqual([
      expect.stringContaining("Morning bottle"),
      expect.stringContaining("Evening nap"),
    ]);

    entryButtons[0]!.focus();
    await user.keyboard("{Enter}");
    expect(openRecord).toHaveBeenCalledWith(records[1]);
  });
});
