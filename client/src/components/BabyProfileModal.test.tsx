import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BabyProfileModal } from "./BabyProfileModal";

describe("BabyProfileModal", () => {
  it("validates and saves an edited profile", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <BabyProfileModal
        baby={{
          name: "Clement",
          birthdate: "2026-08-09",
          weightValue: null,
          weightUnit: "lb",
        }}
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
});
