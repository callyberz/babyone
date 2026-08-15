import { describe, expect, it } from "vitest";
import { createRequestId } from "./requestId";

const ACCEPTED_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

describe("createRequestId", () => {
  it("creates distinct identifiers accepted by the API", () => {
    const ids = Array.from({ length: 20 }, () => createRequestId());
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(ACCEPTED_REQUEST_ID);
  });
});
