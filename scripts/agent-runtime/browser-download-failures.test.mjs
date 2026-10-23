import assert from "node:assert/strict";
import test from "node:test";
import { assertExpectedDownloadFailures } from "./browser-download-failures.mjs";

const rejected = (changes = {}) => ({
  command: "browser_downloads_action",
  transport: "electron-ipc",
  status: "error",
  args_preview: { id: "native-original", action: "open" },
  ...changes,
});

test("accepts exactly the two correlated native open failures and successful calls", () => {
  assert.equal(
    assertExpectedDownloadFailures(
      [
        rejected(),
        { command: "browser_downloads_list", status: "success" },
        rejected(),
      ],
      "native-original",
    ),
    2,
  );
});

test("rejects missing, additional and unrelated errors", () => {
  for (const trace of [
    [rejected()],
    [rejected(), rejected(), rejected()],
    [rejected(), rejected({ command: "app_server_handle_json_lines" })],
  ])
    assert.throws(() =>
      assertExpectedDownloadFailures(trace, "native-original"),
    );
});

test("rejects foreign ids, actions and fallback transports", () => {
  for (const event of [
    rejected({ args_preview: { id: "another-record", action: "open" } }),
    rejected({ args_preview: { id: "native-original", action: "cancel" } }),
    rejected({ transport: "mock" }),
  ])
    assert.throws(() =>
      assertExpectedDownloadFailures([rejected(), event], "native-original"),
    );
});
