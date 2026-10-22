import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/** 只观察真实原生对话框；原始参数、返回 Promise 和选择结果全部原样委托。 */
export async function observeNativeSaveDialogs(app) {
  const key = `__nativeSaveDialog_${randomUUID()}`;
  const owner = await app.evaluate(({ dialog }, key) => {
    const original = dialog.showSaveDialog;
    const capture = { calls: [], original };
    const observed = function (...args) {
      const options = args.at(-1) ?? {};
      const call = {
        index: capture.calls.length,
        pid: process.pid,
        status: "pending",
        title: options.title,
        defaultPath: options.defaultPath,
        startedAt: new Date().toISOString(),
      };
      capture.calls.push(call);
      let result;
      try {
        result = Reflect.apply(original, this, args);
      } catch (error) {
        call.status = "error";
        call.error = String(error);
        throw error;
      }
      Promise.resolve(result).then(
        (result) => {
          call.status = "completed";
          call.finishedAt = new Date().toISOString();
          call.result = {
            canceled: result.canceled,
            filePath: result.filePath,
          };
        },
        (error) => {
          call.status = "error";
          call.error = String(error);
        },
      );
      return result;
    };
    capture.observed = observed;
    globalThis[key] = capture;
    dialog.showSaveDialog = observed;
    if (dialog.showSaveDialog !== observed)
      throw new Error("Native save observer was not installed");
    return { pid: process.pid, executable: process.execPath };
  }, key);
  const snapshot = () =>
    app.evaluate((_electron, key) => globalThis[key].calls, key);
  return {
    owner,
    snapshot,
    async stop() {
      return app.evaluate(({ dialog }, key) => {
        const capture = globalThis[key];
        if (dialog.showSaveDialog !== capture.observed)
          throw new Error("Native save observer ownership changed");
        dialog.showSaveDialog = capture.original;
        const result = {
          calls: capture.calls,
          originalRestored: dialog.showSaveDialog === capture.original,
        };
        delete globalThis[key];
        return result;
      }, key);
    },
  };
}

async function waitForCall(observer, index, completed, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const call = (await observer.snapshot())[index];
    if (call && (!completed || call.status !== "pending")) return call;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `Native save dialog ${index} ${completed ? "result" : "invocation"} timed out`,
  );
}

/** 本场景需要原生 UI 操作者；证据文件公布精确 PID、默认源文件与预期用户选择。 */
export async function captureNativeSaveDialog(
  { observer, evidenceDir, label, sourcePath, destination, onPending },
  action,
) {
  const index = (await observer.snapshot()).length;
  await action();
  const pending = await waitForCall(observer, index, false, 15_000);
  assert.equal(pending.status, "pending");
  assert.equal(pending.defaultPath, sourcePath);
  assert.equal(pending.pid, observer.owner.pid);
  const sourceAtDialog = await onPending();
  fs.writeFileSync(
    path.join(evidenceDir, `native-save-${label}-pending.json`),
    JSON.stringify(
      {
        ...observer.owner,
        ...pending,
        expectedSelection: destination,
        sourceAtDialog,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`[native-save-dialog] ${label} pid=${pending.pid}`);
  const result = await waitForCall(observer, index, true, 120_000);
  assert.equal(result.status, "completed", result.error);
  assert.equal(result.result.canceled, destination === null);
  if (destination !== null) assert.equal(result.result.filePath, destination);
  fs.writeFileSync(
    path.join(evidenceDir, `native-save-${label}-result.json`),
    JSON.stringify({ ...result, sourceAtDialog }, null, 2) + "\n",
  );
  return { ...result, sourceAtDialog };
}
