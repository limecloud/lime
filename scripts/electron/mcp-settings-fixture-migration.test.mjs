import fs from "node:fs";
import { expect, it } from "vitest";
import { waitForDynamicCatalog } from "./mcp-list-changed-gate-b.mjs";

const owner = "list-changed-gate-b";
const observation = (method) => ({
  electron: true,
  fallback: false,
  command: "app_server_handle_json_lines",
  transport: "electron-ipc",
  status: "success",
  method,
  requestId: method + "-test-only",
  responseId: method + "-test-only",
});
const catalogue = (server = owner) => ({
  "mcpTool/list": {
    tools: [
      {
        name: "mcp__" + server + "__dynamic_refresh_probe",
        server_name: server,
      },
    ],
  },
  "mcpPrompt/list": {
    prompts: [{ name: "dynamic_release_prompt", server_name: server }],
  },
  "mcpResource/list": {
    resources: [{ uri: "fixture://dynamic-status", server_name: server }],
  },
});

it("reads the refreshed catalogue from its exact server and current IPC responses, without claiming settings UI", async () => {
  const calls = [];
  const data = catalogue();
  const result = await waitForDynamicCatalog(
    {},
    { timeoutMs: 100, intervalMs: 1 },
    async (_page, method) => {
      calls.push(method);
      return { result: data[method], ipcObservation: observation(method) };
    },
  );
  expect(calls).toEqual(["mcpTool/list", "mcpPrompt/list", "mcpResource/list"]);
  expect(result).toEqual({
    dynamicCatalogReadback: true,
    proofLevel: "Electron IPC / App Server protocol",
    settingsCatalogUi: false,
  });
});

it("rejects unrelated server data and mismatched response identities", async () => {
  const unrelated = catalogue("another-server");
  await expect(
    waitForDynamicCatalog(
      {},
      { timeoutMs: 10, intervalMs: 1 },
      async (_page, method) => ({
        result: unrelated[method],
        ipcObservation: observation(method),
      }),
    ),
  ).rejects.toThrow("did not refresh");
  const data = catalogue();
  await expect(
    waitForDynamicCatalog(
      {},
      { timeoutMs: 100, intervalMs: 1 },
      async (_page, method) => ({
        result: data[method],
        ipcObservation: { ...observation(method), responseId: "unrelated" },
      }),
    ),
  ).rejects.toThrow("matching real preload");
});

it.each([
  "scripts/electron/mcp-config-fixture-smoke.mjs",
  "scripts/electron/mcp-startup-notification-fixture-smoke.mjs",
  "scripts/electron/mcp-oauth-notification-fixture-smoke.mjs",
  "scripts/electron/mcp-event-stream-gate-b.mjs",
  "scripts/electron/mcp-list-changed-gate-b.mjs",
  "scripts/electron/settings-mcp-lifecycle-fixture-smoke.mjs",
  "scripts/electron/lib/settings-draft-navigation-scenario.mjs",
])("keeps %s off retired MCP settings selectors and source files", (file) => {
  const source = fs.readFileSync(file, "utf8");
  expect(source).not.toMatch(
    /settings-sidebar-tab-mcp-server|mcp-panel-tab-|src\/components\/mcp\/|mcp-config-(?:description|enabled-lime|json|preset-)/,
  );
});
