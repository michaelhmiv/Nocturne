import { describe, expect, it } from "vitest";
import { formatScheduledLeaseExpiration, ScheduledWorkStoreError } from "./scheduled-work-store.js";

describe("scheduled-work lease timestamp normalization", () => {
  it.each([
    ["PostgreSQL text", "2026-09-21 18:35:25.123+00", "2026-09-21T18:35:25.123Z"],
    ["ISO text", "2026-09-21T18:35:25.123+00:00", "2026-09-21T18:35:25.123Z"],
    ["Date object", new Date("2026-09-21T18:35:25.123Z"), "2026-09-21T18:35:25.123Z"],
  ])("normalizes %s to a stable ISO timestamp", (_label, value, expected) => {
    expect(formatScheduledLeaseExpiration(value)).toBe(expected);
  });

  it("fails explicitly when the database returns an invalid lease timestamp", () => {
    expect(() => formatScheduledLeaseExpiration("not-a-date")).toThrow(ScheduledWorkStoreError);
    expect(() => formatScheduledLeaseExpiration("not-a-date")).toThrow(/invalid timestamp/i);
  });
});
