import fs from "node:fs";
import path from "node:path";

const retiredCommands = [
  "disconnect_browser_connector_session",
  "get_browser_connector_settings_cmd",
  "set_browser_connector_install_root_cmd",
  "set_browser_connector_enabled_cmd",
  "set_system_connector_enabled_cmd",
  "set_browser_action_capability_enabled_cmd",
  "get_browser_connector_install_status_cmd",
  "install_browser_connector_extension_cmd",
  "open_browser_extensions_page_cmd",
  "open_browser_remote_debugging_page_cmd",
  "open_browser_connector_guide_window",
  "get_chrome_profile_sessions",
  "get_chrome_bridge_endpoint_info",
  "get_chrome_bridge_status",
  "get_browser_backend_policy",
  "get_browser_backends_status",
];

const retiredTokens = [
  ...retiredCommands,
  "browserConnectorCommands",
  "lime_extension_bridge",
  "getBrowserConnectorSettings",
  "getBrowserConnectorInstallStatus",
  "getChromeProfileSessions",
  "getChromeBridgeEndpointInfo",
  "getChromeBridgeStatus",
  "getBrowserBackendPolicy",
  "getBrowserBackendsStatus",
  "ChromeBridgeHub",
  "chrome_observer_ws_upgrade",
  "chrome_control_ws_upgrade",
  "pub mod chrome_bridge;",
  "pub mod chrome_bridge_ws;",
  "/lime-chrome-observer",
  "/lime-chrome-control",
];

const deletedFiles = [
  "lime-rs/crates/server/src/chrome_bridge.rs",
  "lime-rs/crates/server/src/handlers/chrome_bridge_ws.rs",
];
const roots = [
  "src",
  "electron",
  "packages",
  "extensions",
  "lime-rs/crates/server/src",
];
const extensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".rs",
  ".json",
]);
const ignoredDirectories = new Set([
  "node_modules",
  "target",
  "dist",
  "__tests__",
  "__mocks__",
  "fixtures",
  "tests",
]);

function* productionFiles(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) yield* productionFiles(file);
    } else if (
      entry.isFile() &&
      extensions.has(path.extname(entry.name)) &&
      !/\.(?:test|spec|testFixtures)\.[^.]+$/u.test(entry.name)
    )
      yield file;
  }
}

/** Removed browser transports must not return through a Host, catalog or server. */
export function collectRetiredBrowserConnectorFailures({
  repoRoot = process.cwd(),
} = {}) {
  const failures = [];
  for (const file of deletedFiles) {
    if (fs.existsSync(path.join(repoRoot, file)))
      failures.push({
        file,
        token: file,
        message: "旧 Chrome WS 实现已删除，禁止恢复平行浏览器控制链",
      });
  }
  for (const root of roots) {
    for (const file of productionFiles(path.join(repoRoot, root))) {
      const source = fs.readFileSync(file, "utf8");
      for (const token of retiredTokens) {
        if (source.includes(token))
          failures.push({
            file: path.relative(repoRoot, file).split(path.sep).join("/"),
            token,
            message:
              "Chrome 仅使用 Computer Use App Server / Native Messaging，旧连接器入口不得回流",
          });
      }
    }
  }
  return failures;
}
