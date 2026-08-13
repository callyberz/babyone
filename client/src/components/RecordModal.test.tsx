import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RoutineRecord } from "../types";
import { RecordModal } from "./RecordModal";

const record: RoutineRecord = {
  id: 7,
  type: "feed",
  at: "2026-08-13T14:30:00.000Z",
  title: "Bottle — 3 oz",
  detail: "",
  meta: { volume_oz: 3, side: "bottle" },
};

describe("RecordModal", () => {
  it("only closes after an edit is saved successfully", async () => {
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(new Error("Connection lost"))
      .mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    render(
      <RecordModal
        record={record}
        onClose={onClose}
        onSave={onSave}
        onDelete={vi.fn()}
      />,
    );

    const user = userEvent.setup();
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Evening bottle");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Connection lost");
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Evening bottle" }),
    );
  });

  it("requires confirmation and keeps the dialog open when deletion fails", async () => {
    const onDelete = vi.fn().mockRejectedValue(new Error("Delete failed"));
    const onClose = vi.fn();
    render(
      <RecordModal
        record={record}
        onClose={onClose}
        onSave={vi.fn()}
        onDelete={onDelete}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Yes, delete" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Delete failed");
    expect(onDelete).toHaveBeenCalledWith(7);
    expect(onClose).not.toHaveBeenCalled();
  });
});
