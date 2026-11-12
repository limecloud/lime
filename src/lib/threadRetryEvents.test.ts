import { describe, expect, it, vi } from "vitest";
import {
  requestRetryThreadAtTurn,
  subscribeRetryThreadAtTurn,
} from "./threadRetryEvents";

describe("threadRetryEvents", () => {
  it("notifies subscribers and ignores empty identities", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRetryThreadAtTurn(listener);

    requestRetryThreadAtTurn({ threadId: "", turnId: "turn-1" });
    requestRetryThreadAtTurn({ threadId: "thread-1", turnId: "turn-1" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      threadId: "thread-1",
      turnId: "turn-1",
    });

    unsubscribe();
    requestRetryThreadAtTurn({ threadId: "thread-1", turnId: "turn-2" });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
