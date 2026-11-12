import { describe, expect, it } from "vitest";
import { requiresForkConfirmation } from "./forkFromTurnConfirmation";

describe("requiresForkConfirmation", () => {
  it("confirms only for older turns", () => {
    expect(
      requiresForkConfirmation({
        latestTurnId: "turn-3",
        turnId: "turn-2",
      }),
    ).toBe(true);
    expect(
      requiresForkConfirmation({
        latestTurnId: "turn-3",
        turnId: "turn-3",
      }),
    ).toBe(false);
  });

  it("does not confirm when the latest turn is unknown", () => {
    expect(
      requiresForkConfirmation({ latestTurnId: null, turnId: "turn-2" }),
    ).toBe(false);
  });
});
