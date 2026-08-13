import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { ChatMessage, HouseholdSync, RoutineRecord } from "./types";
import {
  applyHouseholdSync,
  messagesKey,
  recordsKey,
} from "./queries";

const record = (id: number, title: string): RoutineRecord => ({
  id,
  type: "other",
  at: `2026-08-13T0${id}:00:00.000Z`,
  title,
  detail: "",
  meta: { category: "note" },
  user: null,
});

const message = (id: number, text: string): ChatMessage => ({
  id,
  from: "bot",
  at: `2026-08-13T0${id}:30:00.000Z`,
  text,
  recordIds: [],
});

const payload = (overrides: Partial<HouseholdSync>): HouseholdSync => ({
  full: false,
  cursor: 10,
  hasMore: false,
  records: [],
  messages: [],
  deletedRecordIds: [],
  deletedMessageIds: [],
  ...overrides,
});

describe("applyHouseholdSync", () => {
  it("replaces both caches from a full snapshot", () => {
    const qc = new QueryClient();
    qc.setQueryData(recordsKey, [record(1, "stale")]);
    qc.setQueryData(messagesKey, [message(1, "stale")]);

    applyHouseholdSync(
      qc,
      payload({
        full: true,
        records: [record(2, "current")],
        messages: [message(2, "current")],
      }),
    );

    expect(
      qc.getQueryData<RoutineRecord[]>(recordsKey)?.map((r) => r.id),
    ).toEqual([2]);
    expect(
      qc.getQueryData<ChatMessage[]>(messagesKey)?.map((m) => m.id),
    ).toEqual([2]);
  });

  it("merges updates and deletions without duplicating entities", () => {
    const qc = new QueryClient();
    qc.setQueryData(recordsKey, [record(1, "old"), record(2, "delete")]);
    qc.setQueryData(messagesKey, [message(1, "old"), message(2, "delete")]);

    applyHouseholdSync(
      qc,
      payload({
        records: [record(1, "updated"), record(3, "new")],
        messages: [message(1, "updated"), message(3, "new")],
        deletedRecordIds: [2],
        deletedMessageIds: [2],
      }),
    );

    expect(
      qc
        .getQueryData<RoutineRecord[]>(recordsKey)
        ?.map((r) => [r.id, r.title]),
    ).toEqual([
      [3, "new"],
      [1, "updated"],
    ]);
    expect(
      qc
        .getQueryData<ChatMessage[]>(messagesKey)
        ?.map((m) => [m.id, m.text]),
    ).toEqual([
      [1, "updated"],
      [3, "new"],
    ]);
  });
});
