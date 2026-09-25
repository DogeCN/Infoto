import { describe, expect, it } from "vitest";
import { isAdminRoute } from "../../src/routing";

describe("admin routing", () => {
  it("mounts Admin only for the exact /admin route", () => {
    expect(isAdminRoute("/admin")).toBe(true);
    expect(isAdminRoute("/admin/")).toBe(false);
    expect(isAdminRoute("/admin/settings")).toBe(false);
    expect(isAdminRoute("/administer")).toBe(false);
  });
});
