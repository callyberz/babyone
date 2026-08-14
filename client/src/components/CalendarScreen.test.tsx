import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CalendarScreen } from "./CalendarScreen";

describe("CalendarScreen personalization", () => {
  it("names the baby in an empty day", () => {
    render(
      <CalendarScreen
        records={[]}
        openRecord={vi.fn()}
        babyName="Riley"
      />,
    );

    expect(
      screen.getByText("No records logged for Riley this day."),
    ).toBeInTheDocument();
  });
});
