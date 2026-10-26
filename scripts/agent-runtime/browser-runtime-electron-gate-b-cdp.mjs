import fs from "node:fs/promises";
import path from "node:path";
import { CDP_CASES } from "./browser-cdp-provider.mjs";
import { CDP_TARGET_CASES } from "./browser-cdp-target-provider.mjs";
import { runBrowserCdpTargetScenario } from "./browser-runtime-electron-gate-b-cdp-targets.mjs";
import { runBrowserCdpEventScenario } from "./browser-runtime-electron-gate-b-cdp-events.mjs";
import {
  appServerCallFromPage,
  readConfigFromPage,
  writeConfigEditsFromPage,
} from "../electron/mcp-config-fixture-smoke.mjs";
import { sendPromptFromGui } from "../lib/chat-fixture/gui-actions.mjs";
import { waitForGuiChatCompleted } from "../lib/chat-fixture/gui-completion-waits.mjs";
import {
  clickApprovalDecision,
  installBrowserApprovalPage,
  readMutationCount,
  waitForApprovalPrompt,
} from "./browser-runtime-electron-gate-b-approval.mjs";
import { waitForBrowserAnnotationState as waitFor } from "./browser-runtime-electron-gate-b-annotation-diagnostics.mjs";
import { readInvokeDiagnostics } from "./browser-runtime-electron-gate-b-cancel.mjs";
import { parseJsonRpcRequestsFromInvokeTrace } from "../electron/lib/mcp-config-fixture-evidence.mjs";
import { assert } from "../lib/chat-fixture/utils.mjs";

/** Runtime provider -> canonical approval -> same native page. DOM input is synthetic. */
export async function runBrowserCdpScenario(ctx) {
  const { app, page, options, identity, providerFixture } = ctx;
  const evidence = {
    schemaVersion: "lime.browser_cdp.v1",
    scenario: "cdp",
    status: "fail",
    proofLevel: "Desktop Gate B / page, Target and frame-session CDP slice",
    physicalInput: false,
    liveProvider: false,
    bridgeReplacement: false,
    checks: [],
    cases: [],
    screenshots: [],
    diagnostics: {},
  };
  const directory = path.dirname(options.output);
  const screenshotDirectory = path.join(
    directory,
    path.basename(options.output, ".json") + "-screenshots",
  );
  const check = (name, value) => {
    assert(value, name);
    evidence.checks.push(name);
  };
  const stage = (name) => {
    evidence.stage = name;
    console.log(`[browser-cdp] stage=${name}`);
  };
  const click = (locator) => locator.evaluate((node) => node.click());
  const snapshot = async (name) => {
    const file = path.join(screenshotDirectory, `cdp-${name}.png`);
    const base64 = await (
      await app.browserWindow(page)
    ).evaluate(async (window) =>
      (await window.webContents.capturePage(undefined, { stayHidden: true }))
        .toPNG()
        .toString("base64"),
    );
    await fs.writeFile(file, Buffer.from(base64, "base64"));
    evidence.screenshots.push(file);
  };
  const setEnabled = async (enabled) => {
    await click(page.getByTestId("app-sidebar-nav-settings"));
    await click(page.getByTestId("settings-sidebar-tab-browser-use"));
    const toggle = page.locator(
      '[role="switch"][aria-labelledby="browser-full-cdp-label"]',
    );
    await waitFor(
      options,
      () => toggle.isEnabled(),
      Boolean,
      "CDP setting is disabled",
    );
    if ((await toggle.getAttribute("aria-checked")) !== String(enabled))
      await click(toggle);
    await waitFor(
      options,
      () => readConfigFromPage(page),
      (value) => value.config.browser?.fullCdpAccessEnabled === enabled,
      "GUI CDP setting did not commit via config/batchWrite",
    );
    await click(page.getByTestId("settings-back-button"));
    return waitFor(
      options,
      () => ctx.readBrowserWorkspaceState(page),
      (state) =>
        state?.threadId === identity.threadId && state.webContentsId > 0,
      "Native browser did not return from settings",
    );
  };
  const pending = () =>
    app.evaluate(() => {
      const read = globalThis.__appServerE2E?.pendingBrowserApprovals;
      if (typeof read !== "function")
        throw new Error("Native approval inspector unavailable");
      return read();
    });
  await fs.mkdir(directory, { recursive: true });
  await fs.mkdir(screenshotDirectory, { recursive: true });
  let count = 0;
  let previousPrompt = null;
  const turnIds = new Set();
  try {
    await installBrowserApprovalPage(app, ctx.guiBeforeTurn.webContentsId);
    await page.evaluate(() => {
      const ids = new Set();
      const observer = new MutationObserver(() => {
        document
          .querySelectorAll(
            '[data-interaction-kind="approval"][data-interaction-id]',
          )
          .forEach((node) => ids.add(node.getAttribute("data-interaction-id")));
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
      window.__browserCdpApprovals = { ids, observer };
    });
    for (const entry of CDP_CASES) {
      stage(`${entry.name}-configure`);
      const before = await setEnabled(entry.enabled);
      const oldTurn = (
        await appServerCallFromPage(page, "thread/read", {
          threadId: identity.threadId,
          includeTurns: true,
        })
      ).result?.thread?.turns?.at(-1)?.id;
      const oldApprovals = await page.evaluate(() => [
        ...window.__browserCdpApprovals.ids,
      ]);
      const promptText = `browser-cdp-${entry.name}`;
      await sendPromptFromGui(page, options, promptText, {
        expectedSessionId: identity.sessionId,
      });
      let prompt = null;
      if (entry.decision) {
        stage(`${entry.name}-approval`);
        prompt = await waitForApprovalPrompt(page, options, previousPrompt);
        const tokens = await pending();
        const current = await ctx.readBrowserWorkspaceState(page);
        const claimed = providerFixture.scenario.cdp.claimed[entry.name];
        check(
          `${entry.name}-single-native-action-token`,
          tokens.length === 1 && tokens[0].tool === "executeCdpCommand",
        );
        check(
          `${entry.name}-canonical-action-prompt`,
          prompt.summary.includes("Runtime.evaluate") &&
            !prompt.decisions.includes("allow_for_session"),
        );
        check(
          `${entry.name}-same-live-owner`,
          claimed?.activeTurnId === current.activeTurnId &&
            claimed?.threadId === identity.threadId &&
            claimed?.tabId === before.tabId &&
            claimed?.webContentsId === before.webContentsId,
        );
        check(
          `${entry.name}-no-mutation-before-decision`,
          (await readMutationCount(app, before.webContentsId)) === count,
        );
        check(
          `${entry.name}-no-result-before-decision`,
          !providerFixture.scenario.cdp.results[entry.name],
        );
        await snapshot(`${entry.name}-approval`);
        if (entry.name === "revoked") {
          // A second config writer changes authority while the GUI keeps this approval mounted.
          const config = await readConfigFromPage(page);
          await writeConfigEditsFromPage(page, {
            expectedVersion: config.version,
            edits: [
              {
                keyPath: "browser",
                mergeStrategy: "replace",
                value: {
                  ...config.config.browser,
                  fullCdpAccessEnabled: false,
                },
              },
            ],
          });
          check(
            "revoked-config-authority",
            (await readConfigFromPage(page)).config.browser
              .fullCdpAccessEnabled === false,
          );
          check(
            "revoked-same-mounted-approval",
            (await waitForApprovalPrompt(page, options)).interactionId ===
              prompt.interactionId,
          );
        }
        await clickApprovalDecision(page, prompt.interactionId, entry.decision);
        previousPrompt = prompt.interactionId;
      }
      stage(`${entry.name}-terminal`);
      await waitFor(
        options,
        () => providerFixture.scenario.cdp.results[entry.name],
        Boolean,
        "Provider did not receive the CDP result",
      );
      const terminal = await waitFor(
        options,
        () =>
          ctx.waitForTerminalThread(
            page,
            options,
            identity.threadId,
            ctx.requestLog,
          ),
        (value) =>
          value.turn?.id !== oldTurn &&
          value.turn?.status === "completed" &&
          JSON.stringify(value.turn).includes(`BROWSER_CDP_DONE_${entry.name}`),
        "CDP canonical turn did not complete",
      );
      const gui = await waitForGuiChatCompleted(page, options, {
        prompt: promptText,
        doneText: `BROWSER_CDP_DONE_${entry.name}`,
        summaryText: `BROWSER_CDP_DONE_${entry.name}`,
        requiredVisibleTexts: [`BROWSER_CDP_DONE_${entry.name}`],
        expectedIdentity: {
          sessionId: identity.sessionId,
          turnId: terminal.turn.id,
        },
      });
      const result = providerFixture.scenario.cdp.results[entry.name];
      if (entry.success) count += 1;
      check(
        `${entry.name}-native-mutation-count`,
        (await readMutationCount(app, before.webContentsId)) === count,
      );
      check(
        `${entry.name}-provider-result`,
        entry.success
          ? result.success && result.value === count
          : !result.success && result.value === null && result.rejected,
      );
      const items =
        terminal.turn.items?.filter(
          (item) =>
            item.type === "dynamicToolCall" &&
            item.namespace === "browser" &&
            item.tool === "executeCdpCommand",
        ) ?? [];
      check(
        `${entry.name}-single-canonical-tool`,
        items.length === 1 && items[0].success === entry.success,
      );
      check(`${entry.name}-unique-turn`, !turnIds.has(terminal.turn.id));
      turnIds.add(terminal.turn.id);
      const after = await waitFor(
        options,
        () => ctx.readBrowserWorkspaceState(page),
        (state) =>
          ["user", "released"].includes(state?.controlOwner) &&
          state.activeTurnId === null,
        "Turn terminal did not release browser control",
      );
      check(
        `${entry.name}-same-native-page`,
        after.tabId === before.tabId &&
          after.viewId === before.viewId &&
          after.webContentsId === before.webContentsId &&
          after.sessionId === ctx.guiBeforeTurn.sessionId,
      );
      check(
        `${entry.name}-detached-at-terminal`,
        (await ctx.readBrowserDebuggerState(app, after.webContentsId))
          .attached === false,
      );
      check(
        `${entry.name}-no-pending-token-at-terminal`,
        (await pending()).length === 0,
      );
      const newApprovals = (
        await page.evaluate(() => [...window.__browserCdpApprovals.ids])
      ).filter((id) => !oldApprovals.includes(id));
      check(
        `${entry.name}-exact-approval-count`,
        newApprovals.length === (entry.decision ? 1 : 0),
      );
      if (entry.success)
        check(
          `${entry.name}-exact-result-route`,
          result.tab?.activeTurnId === terminal.turn.id &&
            result.tab?.threadId === identity.threadId &&
            result.tab?.webContentsId === before.webContentsId,
        );
      await snapshot(`${entry.name}-completed`);
      evidence.cases.push({
        name: entry.name,
        turnId: terminal.turn.id,
        turnStatus: terminal.turn.status,
        browserSessionId: before.sessionId,
        tabId: before.tabId,
        viewId: before.viewId,
        webContentsId: before.webContentsId,
        mutationCount: count,
        approvals: newApprovals.length,
        nativeResult: result,
        canonicalToolId: items[0].id,
        guiTerminal: gui.completionScope,
      });
    }
    await runBrowserCdpEventScenario(ctx, evidence, check, snapshot);
    await runBrowserCdpTargetScenario(ctx, evidence, check, snapshot);
    const traces = ctx.readInvokeTrace();
    const calls = parseJsonRpcRequestsFromInvokeTrace(JSON.stringify(traces));
    evidence.invoke = {
      ...(await readInvokeDiagnostics(page)),
      traceCount: traces.length,
      mockFallbackHitCount: traces.filter(
        (entry) =>
          entry.mock === true ||
          entry.mockFallback === true ||
          [
            entry.transport,
            entry.source,
            entry.fallback,
            entry.fallbackMode,
          ].some((value) => typeof value === "string" && /mock/iu.test(value)),
      ).length,
      calls: calls.map(({ method, transport, status, id, params }) => ({
        method,
        transport,
        status,
        id,
        threadId: params.threadId ?? null,
      })),
    };
    evidence.providerRequestCount = providerFixture.requests.length;
    for (const method of [
      "config/read",
      "config/batchWrite",
      "thread/read",
      "turn/start",
    ])
      check(
        `real-preload-ipc-${method}`,
        calls.some(
          (call) =>
            call.method === method &&
            call.transport === "electron-ipc" &&
            call.status === "success",
        ),
      );
    check(
      "all-canonical-gui-turns",
      calls.filter(
        (call) =>
          call.method === "turn/start" &&
          call.params.threadId === identity.threadId &&
          call.status === "success",
      ).length ===
        CDP_CASES.length + CDP_TARGET_CASES.length + 1,
    );
    check(
      "no-production-mock-fallback",
      evidence.invoke.mockFallbackHitCount === 0,
    );
    check(
      "real-runtime-provider-requests",
      providerFixture.requests.length >=
        (CDP_CASES.length + CDP_TARGET_CASES.length + 1) * 4,
    );
    evidence.host = await app.evaluate(
      () => globalThis.__browserDesignHostEvidence,
    );
    check(
      "real-hidden-host-no-preload-errors",
      evidence.host?.unexpectedShowEvents === 0 &&
        evidence.host?.preloadErrors.length === 0,
    );
    evidence.status = "pass";
    evidence.failedAssertions = [];
    evidence.claimBoundary =
      "真实 runtime/provider 工具请求、十个 GUI 回合、单次批准/拒绝/关闭/同回合配置撤权/重新启用、原生 mutation 和终态 detach；Target 身份/实际跨站 frame/关闭与 session 生命周期；独立审批的持久事件能力、实际原生 console 事件经本地 pipe 到独立 Node 进程、canonical 终态断线与拒绝重放。隐藏窗口使用合成 DOM 输入；第二配置写者不是设置 GUI。不是完整 CDP、完整事件域、WebMCP、物理输入或双平台打包证据。";
    return evidence;
  } catch (error) {
    evidence.error = String(error);
    evidence.provider = providerFixture.scenario.cdp;
    await snapshot("failure").catch(() => undefined);
    await fs.writeFile(
      options.output.replace(/\.json$/u, "-failure.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
    throw error;
  } finally {
    await page
      .evaluate(() => window.__browserCdpApprovals?.observer.disconnect())
      .catch(() => undefined);
  }
}
