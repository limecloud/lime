import { describe, expect, it } from "vitest";
import { AgentStreamSubmitGate } from "./agentStreamSubmitGate";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

describe("AgentStreamSubmitGate", () => {
  it("应串行执行 submit 任务，并在排队期间暴露 pending 状态", async () => {
    const gate = new AgentStreamSubmitGate();
    const firstDeferred = createDeferred<void>();
    const executionOrder: string[] = [];

    const firstRun = gate.run(async () => {
      executionOrder.push("first:start");
      await firstDeferred.promise;
      executionOrder.push("first:end");
    });

    expect(gate.hasPending()).toBe(true);
    expect(gate.getPendingCount()).toBe(1);

    const secondRun = gate.run(async () => {
      executionOrder.push("second:start");
      executionOrder.push("second:end");
    });

    expect(gate.hasPending()).toBe(true);
    expect(gate.getPendingCount()).toBe(2);

    await Promise.resolve();
    expect(executionOrder).toEqual(["first:start"]);

    firstDeferred.resolve();
    await firstRun;
    await secondRun;

    expect(executionOrder).toEqual([
      "first:start",
      "first:end",
      "second:start",
      "second:end",
    ]);
    expect(gate.hasPending()).toBe(false);
    expect(gate.getPendingCount()).toBe(0);
  });
});
