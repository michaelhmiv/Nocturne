import { describe, expect, it } from "vitest";
import { activityRemaining } from "./activity-display.js";

const received = Date.parse("2026-09-22T10:00:00.000Z");
describe("scheduled activity presentation", () => {
  it("uses authoritative server time instead of the client's clock", () => {
    expect(
      activityRemaining("2026-09-22T10:02:00.000Z", "2026-09-22T10:00:00.000Z", received, received)
        .label,
    ).toBe("2m 00s remaining");
    expect(
      activityRemaining(
        "2026-09-22T10:02:00.000Z",
        "2026-09-22T10:00:00.000Z",
        received,
        received + 90_000,
      ).label,
    ).toBe("30s remaining");
  });
  it("does not call an overdue task complete without a committed result", () => {
    expect(
      activityRemaining(
        "2026-09-22T10:00:01.000Z",
        "2026-09-22T10:00:00.000Z",
        received,
        received + 90_000,
      ),
    ).toMatchObject({ overdue: true, seconds: 0, label: "Due — awaiting world confirmation" });
  });
  it("marks missing schedule timestamps unavailable", () => {
    expect(activityRemaining("invalid", "invalid", received, received).label).toBe(
      "Completion time unavailable",
    );
  });
});
