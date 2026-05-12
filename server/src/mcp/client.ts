import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface AnthropicToolSchema {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

let clientPromise: Promise<Client> | null = null;
let cachedToolSchemas: AnthropicToolSchema[] | null = null;

function resolveServerCommand(): { command: string; args: string[] } {
  const isDist = __dirname.includes(`${path.sep}dist${path.sep}`);
  if (isDist) {
    const serverJs = path.resolve(__dirname, "server.js");
    return { command: process.execPath, args: [serverJs] };
  }

  const serverTs = path.resolve(__dirname, "server.ts");
  const tsxBin = path.resolve(
    __dirname,
    "..",
    "..",
    "..",
    "node_modules",
    ".bin",
    "tsx",
  );
  if (fs.existsSync(tsxBin)) {
    return { command: tsxBin, args: [serverTs] };
  }
  return { command: "npx", args: ["tsx", serverTs] };
}

async function startClient(): Promise<Client> {
  const { command, args } = resolveServerCommand();
  const childEnv: Record<string, string> = {
    ...(process.env as Record<string, string>),
  };
  if (!process.env.BABYONE_DB) {
    childEnv.BABYONE_DB = path.resolve(__dirname, "..", "..", "data.db");
  }
  const transport = new StdioClientTransport({
    command,
    args,
    env: childEnv,
    stderr: "inherit",
  });

  const client = new Client(
    { name: "babyone-chat-backend", version: "0.1.0" },
    { capabilities: {} },
  );
  await client.connect(transport);

  const shutdown = () => {
    client.close().catch(() => {});
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.once("beforeExit", shutdown);

  return client;
}

export function getMcpClient(): Promise<Client> {
  if (!clientPromise) clientPromise = startClient();
  return clientPromise;
}

export async function getAnthropicToolSchemas(): Promise<
  AnthropicToolSchema[]
> {
  if (cachedToolSchemas) return cachedToolSchemas;
  const client = await getMcpClient();
  const res = await client.listTools();
  cachedToolSchemas = res.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Record<string, unknown>,
  }));
  return cachedToolSchemas;
}

export interface McpToolCallOutcome {
  text: string;
  isError: boolean;
}

export async function callMcpTool(
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolCallOutcome> {
  const client = await getMcpClient();
  const res = await client.callTool({ name, arguments: args });
  const content = Array.isArray(res.content) ? res.content : [];
  const text = content
    .map((block) => {
      if (
        block &&
        typeof block === "object" &&
        "type" in block &&
        block.type === "text" &&
        "text" in block
      ) {
        return String((block as { text: unknown }).text);
      }
      return JSON.stringify(block);
    })
    .join("\n");
  return { text, isError: Boolean(res.isError) };
}
