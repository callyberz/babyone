import { describe, it, expect } from "vitest";
import { isAdmin } from "./middleware.js";

describe("isAdmin", () => {
  it("accepts a persisted administrator role", () => {
    expect(isAdmin({ role: "administrator" })).toBe(true);
  });

  it("rejects a persisted caregiver role", () => {
    expect(isAdmin({ role: "caregiver" })).toBe(false);
  });

  it("does not consult bootstrap environment variables", () => {
    process.env.BABYONE_ADMIN_EMAIL = "admin@example.com";
    expect(isAdmin({ role: "caregiver" })).toBe(false);
    delete process.env.BABYONE_ADMIN_EMAIL;
    expect(isAdmin({ role: "administrator" })).toBe(true);
  });
});
