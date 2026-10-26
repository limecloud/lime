import { quitMainProcessNormally } from "../../electron/lib/persisted-atom-fixture-driver.mjs";

function bounded(callback, timeoutMs, phase) {
  let timer;
  return Promise.race([
    Promise.resolve().then(callback),
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`fixture teardown timeout: ${phase}`)),
        timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Resource failure is a failed Gate, even when all business assertions passed. */
export async function settleFixtureResources({
  app,
  mainExit,
  cdpBrowser,
  invokeTraceCollector,
  imageProviderFixtureServer,
  textProviderFixtureServer,
  cleanupTemp,
  timeoutMs = 15_000,
  failureCleanupTimeoutMs = 5_000,
}) {
  const result = {
    ok: true,
    steps: [],
    normalMainExit: null,
    forcedCleanup: null,
  };
  const settle = async (phase, callback) => {
    const startedAt = new Date().toISOString();
    try {
      const value = await callback();
      result.steps.push({
        phase,
        startedAt,
        completedAt: new Date().toISOString(),
        ok: true,
      });
      return value;
    } catch (error) {
      result.ok = false;
      result.steps.push({
        phase,
        startedAt,
        completedAt: new Date().toISOString(),
        ok: false,
        error: String(error),
      });
      return null;
    }
  };
  if (invokeTraceCollector)
    await settle("invoke-trace", () =>
      bounded(() => invokeTraceCollector.stop(), timeoutMs, "invoke-trace"),
    );
  if (cdpBrowser)
    await settle("cdp", () =>
      bounded(() => cdpBrowser.close(), timeoutMs, "cdp"),
    );
  if (app) {
    result.normalMainExit = await settle("normal-main-exit", () =>
      quitMainProcessNormally({ app, exit: mainExit }, timeoutMs),
    );
    if (!result.normalMainExit && mainExit?.getExitRecord() === null) {
      // Reap only this launch's Main after the Gate has already failed. A signal
      // receipt never repairs normalMainExit or the failed Gate result.
      result.forcedCleanup = await settle("failed-main-reap", async () => {
        const child = app.process();
        if (child.pid !== mainExit.pid)
          throw new Error("fixture Main ownership changed; refusing to signal");
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGKILL");
        return bounded(
          () => mainExit.exitPromise,
          failureCleanupTimeoutMs,
          "failed-main-reap",
        );
      });
    }
  }
  for (const [phase, server] of [
    ["image-provider", imageProviderFixtureServer],
    ["text-provider", textProviderFixtureServer],
  ]) {
    if (server)
      await settle(phase, () =>
        bounded(() => server.close(), timeoutMs, phase),
      );
  }
  if (cleanupTemp) await settle("temp-root", cleanupTemp);
  return result;
}
