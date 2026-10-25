import { afterEach, expect, it, vi } from "vitest";
import { ApplicationNetworkRefresh } from "./applicationNetworkRefresh";

afterEach(() => vi.useRealTimers());
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

it("shares one read, caps waiters, and rechecks each request at completion", async () => {
  const gate = new ApplicationNetworkRefresh();
  const read = deferred();
  const refresh = vi.fn(() => read.promise);
  const callback = vi.fn();
  const decide = vi.fn(() => true);
  for (let index = 0; index < 256; index++)
    gate.authorize(refresh, decide, callback);
  const overflow = vi.fn();
  gate.authorize(refresh, decide, overflow);
  expect(overflow).toHaveBeenCalledExactlyOnceWith(false);
  await Promise.resolve();
  expect(refresh).toHaveBeenCalledOnce();
  decide.mockReturnValue(false);
  read.resolve();
  await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(256));
  expect(callback.mock.calls.every(([allowed]) => allowed === false)).toBe(
    true,
  );
});

it("timeout settles once and rejects later requests without reattaching to the stale read", async () => {
  vi.useFakeTimers();
  const gate = new ApplicationNetworkRefresh();
  const read = deferred();
  const refresh = vi.fn(() => read.promise);
  const first = vi.fn();
  gate.authorize(refresh, () => true, first);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(first).toHaveBeenCalledExactlyOnceWith(false);
  const late = vi.fn();
  for (let index = 0; index < 1000; index++)
    gate.authorize(refresh, () => true, late);
  expect(late).toHaveBeenCalledTimes(1000);
  expect(refresh).toHaveBeenCalledOnce();
  read.resolve();
  await vi.runAllTimersAsync();
  expect(first).toHaveBeenCalledOnce();
  const repaired = vi.fn();
  gate.authorize(
    async () => {},
    () => true,
    repaired,
  );
  await vi.runAllTimersAsync();
  expect(repaired).toHaveBeenCalledExactlyOnceWith(true);
});

it("owner disposal and late success cannot authorize a canceled request", async () => {
  const gate = new ApplicationNetworkRefresh();
  const read = deferred();
  const callback = vi.fn();
  gate.authorize(
    () => read.promise,
    () => true,
    callback,
  );
  gate.invalidate();
  expect(callback).toHaveBeenCalledExactlyOnceWith(false);
  read.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(callback).toHaveBeenCalledOnce();
});

it("read failures and final policy exceptions settle closed and permit an explicit retry", async () => {
  const gate = new ApplicationNetworkRefresh();
  const failed = vi.fn();
  gate.authorize(
    async () => {
      throw new Error("unreadable policy");
    },
    () => true,
    failed,
  );
  await vi.waitFor(() => expect(failed).toHaveBeenCalledExactlyOnceWith(false));
  const changed = vi.fn();
  gate.authorize(
    async () => {},
    () => {
      throw new Error("owner changed");
    },
    changed,
  );
  await vi.waitFor(() =>
    expect(changed).toHaveBeenCalledExactlyOnceWith(false),
  );
});
