import { describe, it, expect, beforeEach } from "vitest";
import { isAdmin } from "./middleware.js";

describe("isAdmin", () => {
  beforeEach(() => {
    process.env.BABYONE_ADMIN_EMAIL = "admin@example.com";
  });

  it("true when email matches BABYONE_ADMIN_EMAIL", () => {
    expect(isAdmin("admin@example.com")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isAdmin("ADMIN@example.com")).toBe(true);
  });

  it("false for any other email", () => {
    expect(isAdmin("caregiver@example.com")).toBe(false);
  });

  it("false when BABYONE_ADMIN_EMAIL is unset", () => {
    delete process.env.BABYONE_ADMIN_EMAIL;
    expect(isAdmin("admin@example.com")).toBe(false);
  });
});
