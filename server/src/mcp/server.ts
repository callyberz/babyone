import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import {
  RECORD_TOOLS,
  executeRecordTool,
  handleLogRecord as directHandleLogRecord,
  handleUpdateRecord as directHandleUpdateRecord,
  handleDeleteRecord,
  handleFindRecords,
  type LogRecordInput,
  type UpdateRecordInput,
} from "../records/tools.js";

// Legacy direct exports keep older MCP tests/consumers compatible while the
// main application uses explicit, server-owned execution context.
export function handleLogRecord(
  input: LogRecordInput & { _loggerId?: number | null; _tzOffsetMin?: number },
) {
  return directHandleLogRecord(input, {
    loggerId: input._loggerId,
    tzOffsetMin: input._tzOffsetMin,
  });
}

export function handleUpdateRecord(
  input: UpdateRecordInput & { _tzOffsetMin?: number },
) {
  return directHandleUpdateRecord(input, { tzOffsetMin: input._tzOffsetMin });
}

export { handleDeleteRecord, handleFindRecords };

export function createMcpServer(): Server {
  const server = new Server(
    { name: "babyone-routines", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: RECORD_TOOLS as Tool[],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const handled = executeRecordTool(
      request.params.name,
      (request.params.arguments ?? {}) as Record<string, unknown>,
    );
    return {
      content: [
        {
          type: "text" as const,
          text:
            typeof handled.result === "string"
              ? handled.result
              : JSON.stringify(handled.result),
        },
      ],
      isError: handled.isError,
    };
  });
  return server;
}

const entry = process.argv[1];
const isDirectRun =
  Boolean(entry) &&
  (entry === new URL(import.meta.url).pathname ||
    entry?.endsWith("/mcp/server.js") ||
    entry?.endsWith("/mcp/server.ts"));

if (isDirectRun) {
  const server = createMcpServer();
  server.connect(new StdioServerTransport()).catch((error) => {
    console.error("[mcp-server] failed to start:", error);
    process.exit(1);
  });
}
