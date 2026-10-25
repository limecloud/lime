import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { installAppQuitLifecycle } from "./appQuitLifecycle";

function fixture() {
  const app = new EventEmitter() as EventEmitter & { quit(): void };
  const order: string[] = [];
  const finalEvent = { preventDefault: vi.fn() };
  app.quit = vi.fn(() => {
    order.push("quit");
    const before = { preventDefault: vi.fn() };
    app.emit("before-quit", before);
    if (before.preventDefault.mock.calls.length) return;
    app.emit("will-quit", finalEvent);
  });
  let finish!: () => void;
  let fail!: (error: unknown) => void;
  const stopped = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  const prepare = vi.fn(() => {
    order.push("prepare");
  });
  const dispose = vi.fn(() => {
    order.push("dispose");
    return stopped;
  });
  const onError = vi.fn();
  installAppQuitLifecycle(app, { prepare, dispose, onError });
  return {
    app,
    prepare,
    dispose,
    onError,
    order,
    finalEvent,
    finish,
    fail,
    stopped,
  };
}

describe("App Main quit lifecycle", () => {
  it("defers window teardown until the current owners have drained", async () => {
    const f = fixture();
    const willQuit = vi.fn();
    f.app.on("will-quit", willQuit);
    f.app.quit();
    await Promise.resolve();
    expect(f.prepare).toHaveBeenCalledOnce();
    expect(f.dispose).toHaveBeenCalledOnce();
    expect(willQuit).not.toHaveBeenCalled();
    const quit = new Promise<void>((resolve) =>
      f.app.once("will-quit", resolve),
    );
    f.finish();
    await quit;
    expect(willQuit).toHaveBeenCalledOnce();
    expect(f.finalEvent.preventDefault).not.toHaveBeenCalled();
  });

  it("prepares once, waits for async stop, then permits the resumed quit", async () => {
    const f = fixture();
    const first = { preventDefault: vi.fn() };
    f.app.emit("before-quit", first);
    f.app.emit("will-quit", first);
    await Promise.resolve();
    expect(first.preventDefault).toHaveBeenCalledOnce();
    expect(f.order).toEqual(["prepare", "dispose"]);
    expect(f.app.quit).not.toHaveBeenCalled();
    const quit = new Promise<void>((resolve) =>
      f.app.once("will-quit", () => resolve()),
    );
    f.finish();
    await quit;
    expect(f.order).toEqual(["prepare", "dispose", "quit"]);
    expect(f.prepare).toHaveBeenCalledOnce();
    expect(f.finalEvent.preventDefault).not.toHaveBeenCalled();
    expect(f.onError).not.toHaveBeenCalled();
  });

  it("repeated quit requests join one drain and cannot exit before it finishes", async () => {
    const f = fixture();
    const events = Array.from({ length: 3 }, () => ({
      preventDefault: vi.fn(),
    }));
    for (const event of events) {
      f.app.emit("before-quit", event);
      f.app.emit("will-quit", event);
    }
    await Promise.resolve();
    expect(f.prepare).toHaveBeenCalledOnce();
    expect(f.dispose).toHaveBeenCalledOnce();
    expect(f.app.quit).not.toHaveBeenCalled();
    expect(
      events.every((event) => event.preventDefault.mock.calls.length === 1),
    ).toBe(true);
    const quit = new Promise<void>((resolve) =>
      f.app.once("will-quit", () => resolve()),
    );
    f.finish();
    await quit;
    expect(f.app.quit).toHaveBeenCalledOnce();
  });

  it("records stop rejection and resumes quit without retrying cleanup", async () => {
    const f = fixture(),
      failure = new Error("sidecar stop failed");
    f.app.emit("before-quit", { preventDefault() {} });
    f.app.emit("will-quit", { preventDefault() {} });
    const quit = new Promise<void>((resolve) =>
      f.app.once("will-quit", () => resolve()),
    );
    f.fail(failure);
    await quit;
    expect(f.onError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(f.dispose).toHaveBeenCalledOnce();
    expect(f.prepare).toHaveBeenCalledOnce();
    expect(f.app.quit).toHaveBeenCalledOnce();
  });
});
