// Real Electron entry for the shared WPS live scenario; no production bypasses.
import assert from "node:assert/strict";
import path from "node:path";
import {
  launchElectronFixture,
  readConfigFromPage,
  writeConfigEditsFromPage,
} from "../electron/mcp-config-fixture-smoke.mjs";
import { inspectElectronFixtureBuildFreshness } from "../lib/electron-fixture-build.mjs";
import {
  bindGuiWorkspaceAndModelPreferences,
  ensureDefaultWorkspace,
  initializeAppServer,
  invokeAppServerFromPage,
  waitForRendererReady,
} from "../agent-runtime/claw-chat-current-fixture-rpc.mjs";
import {
  captureInvokeTraceCollector,
  installInvokeTraceCollector,
  stopInvokeTraceCollector,
  validateInvokeTraceCollectorCapture,
} from "../lib/invoke-trace-collector.mjs";
import { parseJsonRpcRequestsFromInvokeTrace } from "../electron/lib/mcp-config-fixture-evidence.mjs";
import { terminalGateRuntimeEnvironment } from "./terminal-gate-binaries.mjs";

export async function startWpsDesktop({ root, binaries, receipt }) {
  const options = { timeoutMs: 120000, intervalMs: 100 };
  assert.equal(
    inspectElectronFixtureBuildFreshness({ rootDir: process.cwd() }).ready,
    true,
    "current Electron build required",
  );
  receipt.consoleErrors = [];
  receipt.pageErrors = [];
  const handle = await launchElectronFixture({
    options,
    runtimeEnv: {
      tempRoot: root,
      electronUserDataDir: path.join(root, "electron"),
      env: {
        ...terminalGateRuntimeEnvironment({
          appServerBinaryPath: binaries.appServerBinaryPath,
        }),
        LIME_CONFIG_PATH: path.join(root, "config.yaml"),
        LIME_AGENT_RUNTIME_ROOT: path.join(root, "runtime"),
      },
    },
    appServerEnv: { APP_SERVER_BIN: binaries.appServerBinaryPath },
    backendMode: "runtime",
    consoleErrors: receipt.consoleErrors,
    pageErrors: receipt.pageErrors,
  });
  let collector;
  const requestLog = [];
  const invoke = async (method, params = {}) => {
    const response = await invokeAppServerFromPage(
      handle.page,
      method,
      params,
      requestLog,
    );
    assert(!response.error, `${method}: ${JSON.stringify(response.error)}`);
    return response.result;
  };
  try {
    await initializeAppServer(handle.page, requestLog);
    const initial = await readConfigFromPage(handle.page);
    assert(
      initial.filePath &&
        path.resolve(initial.filePath).startsWith(root + path.sep),
      "write only the isolated Electron config",
    );
    await writeConfigEditsFromPage(handle.page, {
      expectedVersion: initial.version,
      edits: [
        {
          keyPath: "features",
          value: {
            ...initial.config.features,
            computer_use: false,
            chrome_use: false,
            office_use: true,
          },
          mergeStrategy: "replace",
        },
      ],
    });
    const saved = await readConfigFromPage(handle.page);
    assert.equal(saved.config.features.office_use, true);
    receipt.desktopConfig = { isolated: true, features: saved.config.features };
    const workspace = await ensureDefaultWorkspace(handle.page, requestLog);
    assert(workspace.rootPath, "isolated desktop workspace root");
    receipt.desktopIdentity = handle.rendererSnapshot;
    return {
      pid: handle.app.process().pid,
      workspaceRoot: workspace.rootPath,
      invoke,
      async prepareThread(thread, provider) {
        await bindGuiWorkspaceAndModelPreferences(
          handle.page,
          workspace.workspaceId,
          {
            sessionId: thread.sessionId,
            provider: provider.providerPreference,
            model: provider.modelPreference,
          },
        );
        await handle.page.evaluate((sessionId) => {
          sessionStorage.setItem(
            "lime.appNavigation.restore.v1",
            JSON.stringify({
              page: "agent",
              params: { initialSessionId: sessionId },
            }),
          );
        }, thread.sessionId);
        await handle.page.reload({ waitUntil: "domcontentloaded" });
        await waitForRendererReady(handle.page, options);
        const editor = handle.page.locator(
          `[data-testid="composer-editor"][data-session-id="${thread.sessionId}"]`,
        );
        await editor.waitFor({ state: "visible" });
        collector = await installInvokeTraceCollector(handle.page);
      },
      async send(thread, prompt) {
        const editor = handle.page.locator(
          `[data-testid="composer-editor"][data-session-id="${thread.sessionId}"]`,
        );
        await editor.fill(prompt);
        const button = editor
          .locator('xpath=ancestor::*[@data-testid="inputbar-core-container"]')
          .locator('[data-testid="send-btn"]');
        await button.click();
      },
      async verifyVisible(thread, evidenceDir) {
        await handle.page
          .getByText("WPS_FIXTURE_TURN_COMPLETE", { exact: true })
          .last()
          .waitFor({ state: "visible" });
        assert.equal(
          await handle.page.evaluate(
            () =>
              window.__LIME_ELECTRON__ === true &&
              typeof window.electronAPI?.invoke === "function" &&
              window.electronAPI?.devBridgeFallback !== true,
          ),
          true,
        );
        const captured = await captureInvokeTraceCollector(
          handle.page,
          collector,
        );
        const validated = validateInvokeTraceCollectorCapture(
          captured,
          collector,
        );
        assert.equal(
          validated.complete,
          true,
          "continuous preload trace provenance",
        );
        const requests = parseJsonRpcRequestsFromInvokeTrace(
          JSON.stringify(validated.ledgerEntries),
        );
        for (const method of ["turn/start", "thread/read"])
          assert(
            requests.some(
              (r) =>
                r.method === method &&
                r.transport === "electron-ipc" &&
                r.status === "success",
            ),
            `real GUI IPC ${method}`,
          );
        receipt.desktopTrace = {
          provenance: validated.provenance,
          requests: requests.map(
            ({ method, transport, status, id, params }) => ({
              method,
              transport,
              status,
              id,
              threadId: params?.threadId,
            }),
          ),
        };
        receipt.visibleThread = {
          threadId: thread.id,
          sessionId: thread.sessionId,
          finalText: "WPS_FIXTURE_TURN_COMPLETE",
        };
        await handle.page.screenshot({
          path: path.join(evidenceDir, "wps-desktop-chat.png"),
        });
        assert.equal(
          receipt.pageErrors.length,
          0,
          JSON.stringify(receipt.pageErrors),
        );
        assert.equal(
          receipt.consoleErrors.length,
          0,
          JSON.stringify(receipt.consoleErrors),
        );
        assert.equal(
          inspectElectronFixtureBuildFreshness({ rootDir: process.cwd() })
            .ready,
          true,
          "Electron sources stayed stable",
        );
      },
      async close() {
        if (collector) {
          await stopInvokeTraceCollector(handle.page, collector);
          collector = null;
        }
        await handle.app.close();
      },
    };
  } catch (error) {
    await handle.app.close();
    throw error;
  }
}
