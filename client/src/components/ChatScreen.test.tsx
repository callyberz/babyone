import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { meKey } from "../auth/useAuth";
import { messagesKey } from "../queries";
import { ChatScreen } from "./ChatScreen";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function renderChat(babyName?: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  queryClient.setQueryData(meKey, {
    id: 1,
    email: "calvin@example.com",
    displayName: "Calvin",
    isAdmin: true,
  });
  queryClient.setQueryData(messagesKey, []);
  queryClient.setQueryData(
    ["brief", new Date().toLocaleDateString("en-CA")],
    { message: null },
  );
  return render(
    <QueryClientProvider client={queryClient}>
      <ChatScreen records={[]} babyName={babyName} />
    </QueryClientProvider>,
  );
}

function successResponse(text: string) {
  return new Response(
    JSON.stringify({
      userMsg: {
        id: 10,
        from: "user",
        at: "2026-08-13T14:00:00.000Z",
        text,
        recordIds: [],
      },
      botMsg: {
        id: 11,
        from: "bot",
        at: "2026-08-13T14:00:01.000Z",
        text: "Logged it.",
        recordIds: [],
      },
      created: [],
      updated: [],
      deleted: [],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("ChatScreen send recovery", () => {
  it("uses the saved baby name in prompts without naming the assistant after the baby", () => {
    renderChat("Riley");

    expect(
      screen.getByRole("button", {
        name: "How much sleep has Riley had today?",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Message about Riley")).toHaveAttribute(
      "placeholder",
      expect.stringContaining("what happened with Riley"),
    );
    expect(screen.queryByText(/Clement/i)).not.toBeInTheDocument();
  });

  it("retries a failed message with the same request ID and no duplicate bubble", async () => {
    let chatAttempts = 0;
    fetchMock.mockImplementation(async (input) => {
      if (input === "/api/messages") {
        return new Response("[]", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === "/api/chat") {
        chatAttempts += 1;
        if (chatAttempts === 1) {
          return new Response(JSON.stringify({ error: "temporarily unavailable" }), {
            status: 503,
            headers: { "content-type": "application/json" },
          });
        }
        return successResponse("Wet diaper");
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });

    renderChat();
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText("Message about your baby"),
      "Wet diaper",
    );
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(
      await screen.findByRole("alert", { name: "" }),
    ).toHaveTextContent("Not sent — temporarily unavailable");
    const conversation = screen.getByRole("log", { name: "Conversation" });
    expect(within(conversation).getAllByText("Wet diaper")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Logged it.");

    expect(screen.queryByText(/Not sent/)).not.toBeInTheDocument();
    expect(within(conversation).getAllByText("Wet diaper")).toHaveLength(1);

    const chatBodies = fetchMock.mock.calls
      .filter(([input]) => input === "/api/chat")
      .map(([, init]) => JSON.parse(String(init?.body)) as {
        text: string;
        requestId: string;
      });
    expect(chatBodies).toHaveLength(2);
    expect(chatBodies[0]?.text).toBe("Wet diaper");
    expect(chatBodies[0]?.requestId).toBeTruthy();
    expect(chatBodies[1]?.requestId).toBe(chatBodies[0]?.requestId);
  });

  it("discards a failed optimistic message", async () => {
    fetchMock.mockImplementation(async (input) => {
      if (input === "/api/messages") {
        return new Response("[]", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === "/api/chat") {
        return new Response(JSON.stringify({ error: "offline" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });

    renderChat();
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText("Message about your baby"),
      "Nap 45 min",
    );
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByText(/Not sent/);

    await user.click(screen.getByRole("button", { name: "Discard" }));

    await waitFor(() =>
      expect(
        within(screen.getByRole("log", { name: "Conversation" })).queryByText(
          "Nap 45 min",
        ),
      ).not.toBeInTheDocument(),
    );
  });
});
