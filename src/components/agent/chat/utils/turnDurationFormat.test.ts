import { describe, expect, it } from "vitest";
import { formatTurnDuration } from "./turnDurationFormat";

describe("formatTurnDuration", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatTurnDuration(42_000)).toBe("42s");
    expect(formatTurnDuration(23 * 60_000 + 42_000)).toBe("23m 42s");
    expect(formatTurnDuration(3_600_000 + 5 * 60_000)).toBe("1h 5m");
  });
});
