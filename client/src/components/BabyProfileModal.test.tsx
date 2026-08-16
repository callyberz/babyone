import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { BabyProfileModal } from "./BabyProfileModal";

const baby = {
  name: "Clement",
  birthdate: "2026-08-09",
  weightValue: null,
  weightUnit: "lb" as const,
};

describe("BabyProfileModal", () => {
  it("validates and saves an edited profile", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <BabyProfileModal
        baby={baby}
        onClose={onClose}
        onSave={onSave}
      />,
    );

    const user = userEvent.setup();
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Clemmie");
    await user.type(screen.getByLabelText("Current weight (optional)"), "7.4");
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        name: "Clemmie",
        birthdate: "2026-08-09",
        weightValue: 7.4,
        weightUnit: "lb",
      }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("is an identified dialog, focuses the first field, and restores focus", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Edit baby profile</button>
          {open && (
            <BabyProfileModal
              baby={baby}
              onClose={() => setOpen(false)}
              onSave={onSave}
            />
          )}
        </>
      );
    }

    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Edit baby profile" });
    await user.click(opener);

    const dialog = screen.getByRole("dialog", { name: "Baby profile" });
    expect(dialog).toHaveAccessibleDescription(
      "Keep age and handoff details accurate for every caregiver.",
    );
    expect(screen.getByLabelText("Name")).toHaveFocus();

    const close = screen.getByRole("button", { name: "Close baby profile" });
    const save = screen.getByRole("button", { name: "Save profile" });
    close.focus();
    await user.tab({ shift: true });
    expect(save).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(opener).toHaveFocus();
  });

  it("keeps edits and blocks dismissal while a save is in progress", async () => {
    let rejectSave!: (error: Error) => void;
    const onSave = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSave = reject;
        }),
    );
    const onClose = vi.fn();
    render(
      <BabyProfileModal baby={baby} onClose={onClose} onSave={onSave} />,
    );

    const user = userEvent.setup();
    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Clemmie");
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    const dialog = screen.getByRole("dialog");
    fireEvent.mouseDown(dialog.parentElement!);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => rejectSave(new Error("Connection lost")));
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection lost");
    expect(name).toHaveValue("Clemmie");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("submits from the form and announces contract validation", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <BabyProfileModal baby={baby} onClose={vi.fn()} onSave={onSave} />,
    );

    const user = userEvent.setup();
    const name = screen.getByLabelText("Name");
    await user.clear(name);
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("name must be a non-empty string")).toHaveAttribute(
      "aria-live",
      "polite",
    );
    expect(screen.getByRole("button", { name: "Save profile" })).toBeDisabled();

    await user.type(name, "Clemmie{Enter}");
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });
});
