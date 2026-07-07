import { type Tool } from "@modelcontextprotocol/sdk/types.js";

export const TOOLS: Tool[] = [
  {
    name: "log_record",
    description:
      "Create a new routine entry for the baby. Call once per event — if the parent describes multiple things, call this multiple times.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description:
            "Short snake_case category derived from what the parent said. Prefer canonical types (feed, sleep, diaper, meds, play, mood) when they clearly fit. Otherwise invent a new short snake_case label (e.g. 'bath', 'tummy_time', 'doctor_visit'). Never call this tool with an empty or vague type — ask the parent in text instead.",
        },
        at: {
          type: "string",
          description:
            "The parent's LOCAL wall-clock time the event happened, as an ISO-8601 string with NO timezone suffix (e.g. '2026-07-06T14:35:00') — use the 'local now' value from the user message to fill in today's date. Do not convert to UTC or add a 'Z'; the backend does that conversion. Omit entirely to use the current time.",
        },
        title: {
          type: "string",
          description:
            'Short human title (e.g. "Bottle — 3 oz", "Nap — 45 min", "Diaper — wet").',
        },
        detail: {
          type: "string",
          description: "Optional short detail string.",
        },
        meta: {
          type: "object",
          description:
            "Type-specific metadata. feed: { volume_oz?, side? (left|right|both|bottle), mins? }. sleep: { mins, where? (bassinet|crib|stroller|contact) }. diaper: { kind: wet|dirty|both }. play: { mins }. mood: { kind: happy|fussy }. meds: { name?, dose? }. For novel types, include whatever fields make sense.",
          additionalProperties: true,
        },
      },
      required: ["type", "title"],
    },
  },
  {
    name: "update_record",
    description:
      "Modify an existing routine entry. Provide id and any subset of fields to change. meta is shallow-merged with the existing meta.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Record id to update." },
        type: {
          type: "string",
          description:
            "Short snake_case category. Same rules as log_record.type.",
        },
        at: {
          type: "string",
          description:
            "The parent's LOCAL wall-clock time, ISO-8601 with NO timezone suffix. Same rules as log_record.at.",
        },
        title: { type: "string" },
        detail: { type: "string" },
        meta: { type: "object", additionalProperties: true },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_record",
    description:
      "Permanently remove a routine entry. Only call when the parent's intent is unambiguous; otherwise ask them to clarify in your reply text.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Record id to delete." },
      },
      required: ["id"],
    },
  },
  {
    name: "find_records",
    description:
      "Search recent routine entries. Use to look up older logs not already in the today's-logs context, or to answer questions about history.",
    inputSchema: {
      type: "object",
      properties: {
        since: {
          type: "string",
          description: "ISO-8601 lower bound (inclusive).",
        },
        until: {
          type: "string",
          description: "ISO-8601 upper bound (inclusive).",
        },
        type: {
          type: "string",
          description: "Filter by exact stored type string.",
        },
        limit: { type: "number", description: "Max rows (default 20)." },
      },
    },
  },
];
