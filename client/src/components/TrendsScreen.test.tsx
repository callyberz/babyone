import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoutineRecord } from "../types";
import { TrendsScreen } from "./TrendsScreen";

const now = new Date(2026, 7, 13, 12, 0, 0);

function daysAgo(days: number, hour = 9) {
  const date = new Date(now);
  date.setDate(date.getDate() - days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

const sleepToday: RoutineRecord = {
  id: 1,
  type: "sleep",
  at: daysAgo(0),
  title: "Morning nap",
  detail: "",
  meta: { mins: 120 },
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});

afterEach(() => vi.useRealTimers());

describe("TrendsScreen range exploration", () => {
  it("switches between 7, 14, and 30-day summaries", () => {
    const records: RoutineRecord[] = [
      sleepToday,
      {
        id: 2,
        type: "feed",
        at: daysAgo(10),
        title: "Bottle",
        detail: "",
        meta: { volume_oz: 4 },
      },
      {
        id: 3,
        type: "diaper",
        at: daysAgo(20),
        title: "Wet diaper",
        detail: "",
        meta: { kind: "wet" },
      },
    ];

    render(<TrendsScreen records={records} />);

    expect(screen.getByRole("heading", { name: "7-day summary" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "7 days" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "14 days" }));
    expect(screen.getByRole("heading", { name: "14-day summary" })).toBeInTheDocument();
    expect(screen.getByText("2 of 14")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "30 days" }));
    expect(screen.getByRole("heading", { name: "30-day summary" })).toBeInTheDocument();
    expect(screen.getByText("3 of 30")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "30 days" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("provides exact daily values in accessible tables", () => {
    render(<TrendsScreen records={[sleepToday]} />);

    const sleepValues = screen.getByRole("table", {
      name: "Sleep daily values",
    });
    expect(within(sleepValues).getByText("2.0 hr")).toBeInTheDocument();
    expect(within(sleepValues).getAllByRole("row")).toHaveLength(8);
    expect(screen.getByText("0.3 hr/day")).toBeInTheDocument();
  });

  it("distinguishes missing metrics from a completely empty range", () => {
    render(<TrendsScreen records={[sleepToday]} />);

    expect(screen.getByText("No feeds logged in this range.")).toBeInTheDocument();
    expect(screen.getByText("No diapers logged in this range.")).toBeInTheDocument();
    expect(screen.getByText("No tummy time logged in this range.")).toBeInTheDocument();
    expect(screen.queryByText(/No activity in the last/)).not.toBeInTheDocument();
  });

  it("suggests a longer window and reveals older activity", () => {
    const olderFeed: RoutineRecord = {
      id: 4,
      type: "feed",
      at: daysAgo(20),
      title: "Bottle",
      detail: "",
      meta: { volume_oz: 3 },
    };
    render(<TrendsScreen records={[olderFeed]} />);

    expect(
      screen.getByRole("heading", { name: "No activity in the last 7 days" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Try a longer range to find earlier routines.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "30 days" }));
    expect(
      screen.queryByRole("heading", { name: /No activity in the last/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Feeds daily values" })).toBeInTheDocument();
  });
});
