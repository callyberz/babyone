import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MAX_RECORD_DETAIL_LENGTH, MAX_RECORD_QUANTITY, MAX_RECORD_TITLE_LENGTH } from "@babyone/contracts";
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

  it("identifies the dialog, focuses the title, and closes with Escape", () => {
    const onClose = vi.fn();
    render(
      <RecordModal
        record={record}
        onClose={onClose}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Edit feeding" });
    expect(dialog).toHaveAccessibleDescription(
      "Update the details for this feeding record.",
    );
    expect(screen.getByLabelText("Title")).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("blocks keyboard and backdrop dismissal while saving", async () => {
    let resolveSave!: () => void;
    const onSave = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
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
    await user.click(screen.getByRole("button", { name: "Save" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.mouseDown(dialog.parentElement!);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => resolveSave());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("uses the shared record limits and blocks invalid quantities", async () => {
    const sleep: RoutineRecord = {
      ...record,
      type: "sleep",
      title: "Nap",
      meta: { mins: 45 },
    };
    render(
      <RecordModal
        record={sleep}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Title")).toHaveAttribute(
      "maxlength",
      String(MAX_RECORD_TITLE_LENGTH),
    );
    expect(screen.getByLabelText("Notes")).toHaveAttribute(
      "maxlength",
      String(MAX_RECORD_DETAIL_LENGTH),
    );
    const duration = screen.getByLabelText("Duration (min)");
    expect(duration).toHaveAttribute("max", String(MAX_RECORD_QUANTITY));

    const user = userEvent.setup();
    await user.clear(duration);
    await user.type(duration, String(MAX_RECORD_QUANTITY + 1));
    expect(duration).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/meta\.mins must be a non-negative number/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("does not submit the edit form while delete confirmation is open", async () => {
    const onSave = vi.fn();
    render(
      <RecordModal
        record={record}
        onClose={vi.fn()}
        onSave={onSave}
        onDelete={vi.fn()}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("button", { name: "Keep it" })).toHaveFocus();
    fireEvent.submit(screen.getByRole("dialog"));
    expect(onSave).not.toHaveBeenCalled();
  });
});
