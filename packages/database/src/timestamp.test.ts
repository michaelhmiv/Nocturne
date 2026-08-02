import { describe, expect, it } from "vitest";
import { toIsoTimestamp, toNullableIsoTimestamp } from "./timestamp.js";

describe("database timestamp normalization", () => {
  it("accepts postgres timestamp strings", () => {
    expect(toIsoTimestamp("2026-08-02 15:13:59.033+00", "event.world_time")).toBe(
      "2026-08-02T15:13:59.033Z",
    );
  });

  it("accepts Date instances", () => {
    expect(toIsoTimestamp(new Date("2026-08-02T15:13:59.033Z"))).toBe("2026-08-02T15:13:59.033Z");
  });

  it("preserves nullable timestamps", () => {
    expect(toNullableIsoTimestamp(null)).toBeNull();
    expect(toNullableIsoTimestamp(undefined)).toBeNull();
  });

  it("fails with a field-specific error for invalid values", () => {
    expect(() => toIsoTimestamp("not-a-date", "action_plans.created_at")).toThrow(
      "action_plans.created_at is not a valid timestamp.",
    );
  });
});
