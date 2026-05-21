import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, dummyVerify } from "./passwords.js";

describe("passwords", () => {
  it("round-trips a hash", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword(hash, "correct horse battery staple")).toBe(
      true,
    );
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("alpha");
    expect(await verifyPassword(hash, "beta")).toBe(false);
  });

  it("dummyVerify resolves to false and does not throw", async () => {
    await expect(dummyVerify("anything")).resolves.toBe(false);
  });

  it("verify against junk does not throw", async () => {
    await expect(verifyPassword("not-a-real-hash", "x")).resolves.toBe(false);
  });
});
