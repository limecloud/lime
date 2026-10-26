import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { captureMainProcessExit } from "../../electron/lib/persisted-atom-fixture-driver.mjs";
import { settleFixtureResources } from "./teardown.mjs";

function fixture() {
  const child = Object.assign(new EventEmitter(), {
    pid: 719,
    exitCode: null,
    signalCode: null,
    kill: vi.fn((signal) => exit(null, signal)),
  });
  function exit(code = 0, signal = null) {
    child.exitCode = code;
    child.signalCode = signal;
    child.emit("exit", code, signal);
  }
  const app = { process: () => child, close: vi.fn(async () => exit()) };
  const cleanupTemp = vi.fn();
  const imageProviderFixtureServer = { close: vi.fn() };
  const textProviderFixtureServer = { close: vi.fn() };
  return {
    app,
    child,
    exit,
    cleanupTemp,
    mainExit: captureMainProcessExit(child),
    imageProviderFixtureServer,
    textProviderFixtureServer,
    timeoutMs: 50,
    failureCleanupTimeoutMs: 50,
  };
}

describe("current fixture resource settlement (explicit fake processes)", () => {
  it("cannot report success before Main actually exits, even when close resolved", async () => {
    const f = fixture();
    f.app.close.mockResolvedValue(undefined);
    let settled = false;
    const pending = settleFixtureResources(f).then((value) => {
      settled = true;
      return value;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(f.cleanupTemp).not.toHaveBeenCalled();
    f.exit();
    expect(await pending).toMatchObject({
      ok: true,
      normalMainExit: { exitCode: 0, signal: null, mode: "normal" },
      forcedCleanup: null,
    });
    expect(f.child.kill).not.toHaveBeenCalled();
    expect(f.cleanupTemp).toHaveBeenCalledOnce();
  });

  it("bounds a hung close, marks failure and reaps only the owned failed Main", async () => {
    const f = fixture();
    f.timeoutMs = 2;
    f.app.close.mockImplementation(() => new Promise(() => {}));
    const result = await settleFixtureResources(f);
    expect(result).toMatchObject({
      ok: false,
      normalMainExit: null,
      forcedCleanup: { pid: 719, exitCode: null, signal: "SIGKILL" },
    });
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: "normal-main-exit",
          ok: false,
          error: expect.stringContaining("normal Main exit timeout"),
        }),
      ]),
    );
    expect(f.child.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
    expect(f.imageProviderFixtureServer.close).toHaveBeenCalledOnce();
    expect(f.textProviderFixtureServer.close).toHaveBeenCalledOnce();
    expect(f.cleanupTemp).toHaveBeenCalledOnce();
  });

  it.each([
    { code: 1, signal: null },
    { code: null, signal: "SIGTERM" },
  ])("rejects an abnormal Main exit %j", async ({ code, signal }) => {
    const f = fixture();
    f.app.close.mockImplementation(async () => f.exit(code, signal));
    const result = await settleFixtureResources(f);
    expect(result.ok).toBe(false);
    expect(result.normalMainExit).toBeNull();
    expect(f.child.kill).not.toHaveBeenCalled();
    expect(f.cleanupTemp).toHaveBeenCalledOnce();
  });

  it("retains collector and provider failures while releasing every remaining resource", async () => {
    const f = fixture();
    f.invokeTraceCollector = {
      stop: vi.fn(() => {
        throw new Error("trace failure");
      }),
    };
    f.cdpBrowser = { close: vi.fn() };
    f.imageProviderFixtureServer.close.mockRejectedValue(
      new Error("provider failure"),
    );
    const result = await settleFixtureResources(f);
    expect(result.ok).toBe(false);
    expect(result.normalMainExit).toMatchObject({ exitCode: 0, signal: null });
    expect(
      result.steps.filter((step) => !step.ok).map((step) => step.phase),
    ).toEqual(["invoke-trace", "image-provider"]);
    expect(f.cdpBrowser.close).toHaveBeenCalledOnce();
    expect(f.textProviderFixtureServer.close).toHaveBeenCalledOnce();
    expect(f.cleanupTemp).toHaveBeenCalledOnce();
  });

  it("does not call a Main that exited before requested normal quit a success", async () => {
    const f = fixture();
    f.exit();
    expect(await settleFixtureResources(f)).toMatchObject({
      ok: false,
      normalMainExit: null,
      forcedCleanup: null,
    });
    expect(f.app.close).not.toHaveBeenCalled();
    expect(f.child.kill).not.toHaveBeenCalled();
  });
});
