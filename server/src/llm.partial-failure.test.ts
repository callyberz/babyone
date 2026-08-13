import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  fallbackLog: vi.fn(),
  markDegraded: vi.fn(),
}));

vi.mock("./llm/config.js", () => ({
  anthropicClient: { messages: { create: mocks.create } },
  getLlmStatus: vi.fn(),
  LLM_CONFIG: {
    model: "test-model",
    chatMaxTokens: 100,
    briefMaxTokens: 100,
    maxToolIterations: 5,
  },
  markLlmDegraded: mocks.markDegraded,
  markLlmHealthy: vi.fn(),
}));

vi.mock("./db.js", () => ({
  findRecords: vi.fn(() => []),
  getRecord: vi.fn(() => ({
    id: 42,
    type: "feed",
    at: "2026-08-13T13:00:00.000Z",
    title: "Bottle — 3 oz",
    detail: "",
    meta: { volume_oz: 3 },
    user: { id: 7, displayName: "Alex" },
  })),
}));

vi.mock("./records/tools.js", () => ({
  RECORD_TOOLS: [
    {
      name: "log_record",
      description: "log",
      inputSchema: { type: "object" },
    },
  ],
  callRecordTool: vi.fn(() => ({
    text: JSON.stringify({ id: 42 }),
    isError: false,
  })),
  handleLogRecord: mocks.fallbackLog,
}));

const { llmParse } = await import("./llm.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LLM failures after durable tool effects", () => {
  it("returns the completed effects without running fallback again", async () => {
    mocks.create
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "log_record",
            input: {
              type: "feed",
              title: "Bottle — 3 oz",
              meta: { volume_oz: 3 },
            },
          },
        ],
      })
      .mockRejectedValueOnce(new Error("provider unavailable"));

    const result = await llmParse(
      "3 oz bottle",
      new Date("2026-08-13T13:00:00.000Z"),
      7,
      240,
    );

    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.fallbackLog).not.toHaveBeenCalled();
    expect(result.created).toEqual([expect.objectContaining({ id: 42 })]);
    expect(result.replyText).toContain("logged 1");
    expect(mocks.markDegraded).toHaveBeenCalledWith("chat_request_failed");
  });
});
