import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, HouseholdSync, RoutineRecord } from "./types";
import { api } from "./api";
import { meKey } from "./auth/useAuth";
import {
  applyHouseholdSync,
  messagesKey,
  recordsKey,
  syncKey,
  useHouseholdSync,
} from "./queries";

afterEach(() => vi.restoreAllMocks());

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

describe("useHouseholdSync", () => {
  it("immediately drains every available page in cursor order", async () => {
    const firstPage = payload({
      cursor: 500,
      hasMore: true,
      records: [record(1, "first page")],
    });
    const middlePage = payload({
      cursor: 560,
      hasMore: true,
      records: [record(2, "middle page")],
    });
    const finalPage = payload({
      cursor: 620,
      records: [record(3, "final page")],
    });
    const sync = vi
      .spyOn(api, "sync")
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(middlePage)
      .mockResolvedValueOnce(finalPage);
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    qc.setQueryData(meKey, {
      id: 1,
      email: "caregiver@example.com",
      displayName: "Caregiver",
      isAdmin: false,
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children);

    renderHook(() => useHouseholdSync(), { wrapper });

    await waitFor(() => expect(sync).toHaveBeenCalledTimes(3));
    expect(sync.mock.calls).toEqual([[undefined], [500], [560]]);
    await waitFor(() =>
      expect(qc.getQueryData<HouseholdSync>(syncKey)?.cursor).toBe(620),
    );
    expect(
      qc.getQueryData<RoutineRecord[]>(recordsKey)?.map((item) => item.id),
    ).toEqual([3, 2, 1]);
  });
});
