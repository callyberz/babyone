import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RoutineRecord } from "../types";
import { TodayScreen } from "./TodayScreen";

const records: RoutineRecord[] = [
  {
    id: 11,
    type: "diaper",
    at: "2026-08-13T14:30:00.000Z",
    title: "Wet diaper",
    detail: "",
    meta: { kind: "wet" },
  },
  {
    id: 12,
    type: "meds",
    at: "2026-08-12T09:15:00.000Z",
    title: "Vitamin D",
    detail: "After the morning feed",
    meta: { name: "Ddrops", dose: "1 drop" },
    user: { id: 1, displayName: "Alex" },
  },
  {
    id: 13,
    type: "feed",
    at: "2026-08-12T08:30:00.000Z",
    title: "Bottle feed",
    detail: "",
    meta: { side: "bottle", volume_oz: 4 },
    user: { id: 2, displayName: "Jordan" },
  },
];

describe("TodayScreen timeline search", () => {
  it("personalizes its empty state", () => {
    render(
      <TodayScreen
        records={[]}
        openRecord={vi.fn()}
        babyName="Riley"
      />,
    );

    expect(
      screen.getByText("No records logged for Riley yet."),
    ).toBeInTheDocument();
  });

  it("searches titles, notes, categories, and structured record details", async () => {
    render(<TodayScreen records={records} openRecord={vi.fn()} />);
    const user = userEvent.setup();
    const search = screen.getByRole("searchbox", { name: "Search timeline" });

    await user.type(search, "morning");
    expect(screen.getByText("Vitamin D")).toBeInTheDocument();
    expect(screen.queryByText("Wet diaper")).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "4 oz");
    expect(screen.getByText("Bottle feed")).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "meds");
    expect(screen.getByText("Vitamin D")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 record");
  });

  it("combines search and category filters and can reset both", async () => {
    render(<TodayScreen records={records} openRecord={vi.fn()} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /Feeding/ }));
    await user.type(
      screen.getByRole("searchbox", { name: "Search timeline" }),
      "vitamin",
    );

    expect(screen.getByText("No records match your search and filter.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(screen.getByText("Wet diaper")).toBeInTheDocument();
    expect(screen.getByText("Vitamin D")).toBeInTheDocument();
    expect(screen.getByText("Bottle feed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("shows attribution and filters records by caregiver", async () => {
    render(<TodayScreen records={records} openRecord={vi.fn()} />);
    const user = userEvent.setup();

    expect(screen.getByText("Logged by Alex")).toBeInTheDocument();
    expect(screen.getByText("Logged by Jordan")).toBeInTheDocument();
    expect(
      screen.getByText("Logged by an earlier caregiver"),
    ).toBeInTheDocument();

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Filter by caregiver" }),
      "user:1",
    );

    expect(screen.getByText("Vitamin D")).toBeInTheDocument();
    expect(screen.queryByText("Bottle feed")).not.toBeInTheDocument();
    expect(screen.queryByText("Wet diaper")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 record");
  });

  it("opens timeline records from a keyboard-accessible button", async () => {
    const openRecord = vi.fn();
    render(<TodayScreen records={records} openRecord={openRecord} />);
    const user = userEvent.setup();

    const recordButton = screen.getByRole("button", {
      name: /Edit Vitamin D at/,
    });
    recordButton.focus();
    await user.keyboard("{Enter}");

    expect(openRecord).toHaveBeenCalledWith(records[1]);
  });
});

describe("TodayScreen bulk deletion", () => {
  it("preserves the selection and reports a failed delete", async () => {
    const onBulkDelete = vi.fn().mockRejectedValue(new Error("Server offline"));
    render(
      <TodayScreen
        records={records}
        openRecord={vi.fn()}
        isAdmin
        onBulkDelete={onBulkDelete}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Select" }));
    await user.click(screen.getByRole("button", { name: /Select Wet diaper/ }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Server offline");
    expect(
      screen.getByRole("button", { name: /Deselect Wet diaper/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(onBulkDelete).toHaveBeenCalledWith([11]);
  });
});
