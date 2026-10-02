import fs from "node:fs";
import { describe, expect, it } from "vitest";

function readSmokeScript() {
  return fs.readFileSync(
    "scripts/electron/mcp-config-fixture-smoke.mjs",
    "utf8",
  );
}

function readEvidenceCore() {
  return fs.readFileSync(
    "scripts/electron/lib/mcp-config-fixture-evidence.mjs",
    "utf8",
  );
}

describe("MCP config Electron fixture smoke guard", () => {
  it("keeps the smoke on real Electron Desktop Host IPC and App Server JSON-RPC", () => {
    const content = readSmokeScript();

    expect(content).toContain("import { _electron as electron }");
    expect(content).toContain("electron.launch({");
    expect(content).toContain("APP_SERVER_HANDLE_JSON_LINES_COMMAND");
    expect(content).toContain("app_server_handle_json_lines");
    expect(content).toContain("ELECTRON_E2E_USER_DATA_DIR");
    expect(content).toContain('LIME_ELECTRON_E2E: "1"');
    expect(content).toContain('LIME_ELECTRON_DEV_HTTP_BRIDGE: "0"');
    expect(content).toContain("window.__LIME_ELECTRON__ === true");
    expect(content).toContain(
      'typeof window.electronAPI?.invoke === "function"',
    );
    expect(content).toContain("window.electronAPI.supportsCommand");
  });

  it("closes Electron when renderer startup fails before returning a handle", () => {
    const content = readSmokeScript();
    const launchFunction = content.slice(
      content.indexOf("export async function launchElectronFixture"),
      content.indexOf("export async function closeElectronFixture"),
    );

    expect(launchFunction).toContain("try {");
    expect(launchFunction).toContain("catch (error)");
    expect(launchFunction).toContain(
      "await app.close().catch(() => undefined)",
    );
    expect(launchFunction).toContain("throw error");
  });

  it("creates Context7 through the GUI and verifies current MCP methods", () => {
    const content = readSmokeScript();
    const evidenceCore = readEvidenceCore();

    expect(content).toContain('backendMode = "unavailable"');
    expect(content).toContain("APP_SERVER_BACKEND_MODE: backendMode");
    expect(evidenceCore).toContain('"mcpServer/create"');
    expect(evidenceCore).toContain('"mcpServer/list"');
    expect(content).toContain("MCP_CREATE_LIST_REQUIRED_METHODS");
    expect(content).not.toContain("[...REQUIRED_METHODS]");
    expect(content).toContain("mcp-config-preset-context7");
    expect(content).toContain("mcp-config-connection-url");
    expect(content).toContain("mcp-config-env-header-env-var");
    expect(content).toContain("mcp-config-save");
    expect(evidenceCore).toContain("LEGACY_MCP_COMMANDS");
    expect(content).not.toContain("mockPriorityCommands");
    expect(content).not.toContain("defaultMocks");
    expect(content).not.toContain("invokeMockOnly");
  });

  it("opens settings through the current sidebar rail before the legacy account fallback", () => {
    const content = readSmokeScript();

    expect(content).toContain('[data-testid="app-sidebar-nav-settings"]');
    expect(content).toContain("settingsNav.first().isVisible()");
    expect(content).toContain('[data-testid="app-sidebar-account-button"]');
    expect(content).toContain('[data-testid="app-sidebar-account-menu"]');
  });

  it("writes same-run SETTINGS scenario evidence without relabeling", () => {
    const content = readSmokeScript();
    const evidenceCore = readEvidenceCore();

    expect(content).toContain("parseMcpConfigFixtureArgs");
    expect(evidenceCore).toContain(
      'MCP_CREATE_LIST_SCENARIO_ID = "mcp-create-list"',
    );
    expect(evidenceCore).toContain('proofLevel: "Gate B-F"');
    expect(evidenceCore).toContain('request.transport === "electron-ipc"');
    expect(evidenceCore).toContain("mockFallbackHitCount");
  });

  it("does not make legacy MCP facade calls as positive evidence", () => {
    const content = readSmokeScript();
    const positiveCallSurface = content.slice(
      content.indexOf("const REQUIRED_METHODS"),
      content.indexOf("function printHelp"),
    );

    expect(positiveCallSurface).not.toContain("get_mcp_servers");
    expect(positiveCallSurface).not.toContain("mcp_start_server");
    expect(positiveCallSurface).not.toContain("add_mcp_server");
  });
});
