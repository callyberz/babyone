import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuickLog } from "./QuickLog";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function renderQuickLog() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <QuickLog babyName="Clement" />
    </QueryClientProvider>,
  );
}

const recordResponse = (
  overrides: Record<string, unknown> = {},
  id = 9,
) =>
  new Response(
    JSON.stringify({
      id,
      type: "diaper",
      at: "2026-08-12T01:00:00.000Z",
      title: "Diaper — wet",
      detail: "",
      meta: { kind: "wet" },
      user: { id: 1, displayName: "Calvin" },
      ...overrides,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

const requestBody = (call = 0) =>
  JSON.parse(String(fetchMock.mock.calls[call]?.[1]?.body)) as Record<
    string,
    unknown
  >;

describe("QuickLog", () => {
  it("logs a wet diaper in one tap and can undo that exact record", async () => {
    fetchMock
      .mockResolvedValueOnce(recordResponse())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    renderQuickLog();
    await userEvent.click(screen.getByRole("button", { name: "Wet diaper" }));

    await waitFor(() =>
      expect(
        screen.getByText("Wet diaper logged just now."),
      ).toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/records",
      expect.objectContaining({ method: "POST" }),
    );
    expect(requestBody()).toMatchObject({
      type: "diaper",
      title: "Diaper — wet",
      meta: { kind: "wet" },
      requestId: expect.any(String),
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Undo Diaper — wet" }),
    );

    await waitFor(() =>
      expect(screen.getByText("Diaper — wet removed.")).toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/records/9",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(
      screen.queryByRole("button", { name: "Undo Diaper — wet" }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["Happy", "happy", "Happy mood"],
    ["Fussy", "fussy", "Fussy spell"],
  ] as const)(
    "logs a %s mood in one tap",
    async (action, kind, title) => {
      fetchMock.mockResolvedValueOnce(
        recordResponse(
          { type: "mood", title, meta: { kind } },
          kind === "happy" ? 10 : 11,
        ),
      );
      renderQuickLog();

      await userEvent.click(screen.getByRole("button", { name: action }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(requestBody()).toMatchObject({
        type: "mood",
        title,
        detail: "",
        meta: { kind },
      });
      expect(
        await screen.findByText(`${action} mood logged just now.`),
      ).toBeInTheDocument();
    },
  );

  it("collects medication and dose in an accessible dialog", async () => {
    fetchMock.mockResolvedValueOnce(
      recordResponse({
        type: "meds",
        title: "Vitamin D",
        detail: "After feeding",
        meta: { name: "Vitamin D", dose: "1 drop" },
      }),
    );
    renderQuickLog();

    await userEvent.click(screen.getByRole("button", { name: "Medication" }));
    const dialog = screen.getByRole("dialog", { name: "Log medication" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(
      screen.getByRole("button", { name: "Log now" }),
    ).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Medication"), "Vitamin D");
    await userEvent.type(screen.getByLabelText("Dose (optional)"), "1 drop");
    await userEvent.type(screen.getByLabelText("Notes (optional)"), "After feeding");
    await userEvent.click(screen.getByRole("button", { name: "Log now" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(requestBody()).toMatchObject({
      type: "meds",
      title: "Vitamin D",
      detail: "After feeding",
      meta: { name: "Vitamin D", dose: "1 drop" },
      requestId: expect.any(String),
    });
    expect(
      await screen.findByText("Vitamin D logged just now."),
    ).toBeInTheDocument();
  });

  it("reuses the exact request when an unchanged one-tap log is retried", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Please try again" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        recordResponse({
          type: "mood",
          title: "Happy mood",
          meta: { kind: "happy" },
        }),
      );
    renderQuickLog();

    await userEvent.click(screen.getByRole("button", { name: "Happy" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Please try again");
    const firstBody = requestBody();

    await userEvent.click(screen.getByRole("button", { name: "Happy" }));
    await screen.findByText("Happy mood logged just now.");

    expect(requestBody(1)).toEqual(firstBody);
  });

  it("reuses the medication draft and request ID on an unchanged retry", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Connection interrupted" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        recordResponse({
          type: "meds",
          title: "Vitamin D",
          meta: { name: "Vitamin D", dose: "1 drop" },
        }),
      );
    renderQuickLog();

    await userEvent.click(screen.getByRole("button", { name: "Medication" }));
    await userEvent.type(screen.getByLabelText("Medication"), "Vitamin D");
    await userEvent.type(screen.getByLabelText("Dose (optional)"), "1 drop");
    await userEvent.click(screen.getByRole("button", { name: "Log now" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Connection interrupted",
    );
    const firstBody = requestBody();

    await userEvent.click(screen.getByRole("button", { name: "Retry log" }));
    await screen.findByText("Vitamin D logged just now.");

    expect(requestBody(1)).toEqual(firstBody);
  });

  it("keeps undo available and reports a failed removal", async () => {
    let resolveDelete!: (response: Response) => void;
    const pendingDelete = new Promise<Response>((resolve) => {
      resolveDelete = resolve;
    });
    fetchMock
      .mockResolvedValueOnce(recordResponse())
      .mockReturnValueOnce(pendingDelete);
    renderQuickLog();

    await userEvent.click(screen.getByRole("button", { name: "Wet diaper" }));
    const undo = await screen.findByRole("button", {
      name: "Undo Diaper — wet",
    });
    await userEvent.click(undo);

    expect(screen.getByText("Removing the last quick log…")).toBeInTheDocument();
    expect(undo).toBeDisabled();

    resolveDelete(
      new Response(JSON.stringify({ error: "Could not remove that log" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not remove that log",
    );
    expect(
      screen.getByRole("button", { name: "Undo Diaper — wet" }),
    ).toBeEnabled();
  });

  it("closes a quick-log dialog with Escape when it is idle", async () => {
    renderQuickLog();
    await userEvent.click(screen.getByRole("button", { name: "Sleep" }));
    expect(screen.getByRole("dialog", { name: "Log sleep" })).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
