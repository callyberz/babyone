import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HouseholdSyncStatus } from "./HouseholdSyncStatus";

const healthyProps = {
  hasSynced: true,
  isFetching: false,
  isError: false,
  error: null,
  updatedAt: Date.UTC(2026, 7, 14, 14, 30),
  onRetry: vi.fn(),
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("HouseholdSyncStatus", () => {
  it("shows initial sync progress and a fixed last-updated time", () => {
    const { rerender } = render(
      <HouseholdSyncStatus
        {...healthyProps}
        hasSynced={false}
        isFetching
        updatedAt={0}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Syncing household data",
    );

    rerender(<HouseholdSyncStatus {...healthyProps} />);

    expect(screen.getByText(/Household synced/)).toBeInTheDocument();
    expect(screen.getByText(/Updated/).closest("time")).toHaveAttribute(
      "datetime",
      "2026-08-14T14:30:00.000Z",
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("makes a background failure retryable and announces recovery", async () => {
    let finishRetry: (() => void) | undefined;
    const onRetry = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRetry = resolve;
        }),
    );
    const { rerender } = render(
      <HouseholdSyncStatus
        {...healthyProps}
        isError
        error={new Error("Connection lost")}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Sync paused · Connection lost",
    );
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Retrying household sync",
    );

    rerender(
      <HouseholdSyncStatus
        {...healthyProps}
        updatedAt={healthyProps.updatedAt + 1_000}
        onRetry={onRetry}
      />,
    );
    finishRetry?.();

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Household sync recovered · Updated just now",
    );
  });

  it("shows cached-data feedback offline and retries when connectivity returns", async () => {
    let online = true;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    const onRetry = vi.fn(() => new Promise<void>(() => undefined));
    render(<HouseholdSyncStatus {...healthyProps} onRetry={onRetry} />);

    online = false;
    fireEvent(window, new Event("offline"));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Offline · Showing saved household data",
    );

    online = true;
    fireEvent(window, new Event("online"));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Retrying household sync",
    );
  });
});
