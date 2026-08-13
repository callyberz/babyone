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
];

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
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Server offline");
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(onBulkDelete).toHaveBeenCalledWith([11]);
  });
});
