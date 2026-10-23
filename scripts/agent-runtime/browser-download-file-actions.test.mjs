import assert from "node:assert/strict";
import test from "node:test";
import { observeBrowserDownloadShell } from "./browser-download-file-actions.mjs";

test("shell observation preserves receiver, arguments, original promise and void result", async () => {
  const promise = Promise.resolve("");
  const seen = [];
  const shell = {
    openPath(...args) {
      seen.push({ receiver: this, args });
      return promise;
    },
    showItemInFolder(...args) {
      seen.push({ receiver: this, args });
    },
  };
  const original = { ...shell };
  const observer = observeBrowserDownloadShell(shell);
  assert.equal(shell.openPath("/fixture/document.rtf", "extra"), promise);
  assert.equal(shell.showItemInFolder("/fixture/document.rtf"), undefined);
  assert.equal(seen[0].receiver, shell);
  assert.deepEqual(
    seen.map((call) => call.args),
    [["/fixture/document.rtf", "extra"], ["/fixture/document.rtf"]],
  );
  await promise;
  assert.deepEqual(observer.actions, [
    {
      action: "open",
      path: "/fixture/document.rtf",
      status: "fulfilled",
      value: "",
    },
    { action: "reveal", path: "/fixture/document.rtf", status: "returned" },
  ]);
  observer.restore();
  assert.equal(shell.openPath, original.openPath);
  assert.equal(shell.showItemInFolder, original.showItemInFolder);
});

test("shell observation preserves asynchronous rejection and synchronous exceptions", async () => {
  const failure = new Error("native failure");
  const promise = Promise.reject(failure);
  const shell = {
    openPath: () => promise,
    showItemInFolder() {
      throw failure;
    },
  };
  const observer = observeBrowserDownloadShell(shell);
  assert.equal(shell.openPath("/fixture/document.rtf"), promise);
  await assert.rejects(promise, (error) => error === failure);
  assert.throws(
    () => shell.showItemInFolder("/fixture/document.rtf"),
    (error) => error === failure,
  );
  assert.equal(observer.actions[0].status, "rejected");
  assert.equal(observer.actions[1].status, "threw");
});

test("shell error strings are recorded unchanged and never converted into success", async () => {
  const shell = {
    openPath: async () => "No application is associated with the file",
    showItemInFolder() {},
  };
  const observer = observeBrowserDownloadShell(shell);
  assert.equal(
    await shell.openPath("/fixture/document.rtf"),
    "No application is associated with the file",
  );
  assert.equal(
    observer.actions[0].value,
    "No application is associated with the file",
  );
});
