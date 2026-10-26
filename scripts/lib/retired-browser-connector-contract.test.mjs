import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectRetiredBrowserConnectorFailures } from "./retired-browser-connector-contract.mjs";

const directories = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

function fixture(files) {
  const repoRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "browser-transport-contract-"),
  );
  directories.push(repoRoot);
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(repoRoot, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return { repoRoot };
}

describe("retired browser connector contract", () => {
  it("允许共享 Computer Use、Embedded Browser 与模型服务 WebSocket", () => {
    expect(
      collectRetiredBrowserConnectorFailures(
        fixture({
          "src/lib/api/computerUseSettings.ts":
            'invokeAppServer("computerUse/setup")',
          "electron/ipcChannels.ts": '"embedded_browser_view_navigate"',
          "lime-rs/crates/server/src/lib.rs":
            '.route("/v1/ws", get(handlers::ws_upgrade_handler))',
        }),
      ),
    ).toEqual([]);
  });

  it.each([
    ["electron/ipcChannels.ts", '"get_chrome_bridge_endpoint_info"'],
    [
      "src/lib/api/browser.ts",
      'safeInvoke("get_browser_connector_settings_cmd")',
    ],
    [
      "src/lib/governance/agentCommandCatalog.json",
      '{"browserConnectorCommands":[]}',
    ],
    ["electron/systemUtilityHost.ts", "getBrowserBackendsStatus() {}"],
  ])("拒绝生产入口 %s", (file, content) => {
    expect(
      collectRetiredBrowserConnectorFailures(fixture({ [file]: content })),
    ).toEqual([expect.objectContaining({ file })]);
  });

  it.each([
    "lime-rs/crates/server/src/chrome_bridge.rs",
    "lime-rs/crates/server/src/handlers/chrome_bridge_ws.rs",
  ])("即使无内容也拒绝恢复旧实现 %s", (file) => {
    expect(
      collectRetiredBrowserConnectorFailures(fixture({ [file]: "" })),
    ).toEqual([expect.objectContaining({ file, token: file })]);
  });

  it.each(["/lime-chrome-observer", "/lime-chrome-control"])(
    "拒绝迁到新文件的旧路由 %s",
    (route) => {
      const file = "lime-rs/crates/server/src/routes.rs";
      expect(
        collectRetiredBrowserConnectorFailures(
          fixture({ [file]: `.route("${route}/:key", handler)` }),
        ),
      ).toEqual([expect.objectContaining({ file, token: route })]);
    },
  );

  it("测试夹具和负向守卫字符串不构成生产入口", () => {
    expect(
      collectRetiredBrowserConnectorFailures(
        fixture({
          "electron/ipcChannels.test.ts":
            'expect("get_chrome_bridge_status").toBeRetired()',
          "src/components/EmptyState.testFixtures.tsx":
            '"get_browser_backend_policy"',
          "packages/test/fixtures/browser.js": '"get_chrome_profile_sessions"',
        }),
      ),
    ).toEqual([]);
  });
});
