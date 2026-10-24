import fs from "node:fs/promises";
import path from "node:path";
import { HISTORY_ACCESS_CASES } from "./browser-history-access-provider.mjs";
import {
  readConfigFromPage,
  appServerCallFromPage,
  writeConfigEditsFromPage,
} from "../electron/mcp-config-fixture-smoke.mjs";
import { sendPromptFromGui } from "./claw-chat-current-fixture-gui-actions.mjs";
import { waitForGuiChatCompleted } from "./claw-chat-current-fixture-gui-completion-waits.mjs";
import {
  waitForApprovalPrompt,
  clickApprovalDecision,
} from "./browser-runtime-electron-gate-b-approval.mjs";
import { waitForBrowserAnnotationState as waitFor } from "./browser-runtime-electron-gate-b-annotation-diagnostics.mjs";
import { assert } from "./claw-chat-current-fixture-utils.mjs";

/** Real GUI/config/runtime/native-history path. Hidden windows use synthetic DOM input. */
export async function runBrowserHistoryAccessScenario(ctx) {
  const { app, page, options, identity, providerFixture } = ctx;
  const evidence = {
    schemaVersion: "lime.browser_history_access.v1",
    scenario: "history-access",
    status: "fail",
    proofLevel: "Gate B / history access slice",
    physicalInput: false,
    bridgeReplacement: false,
    checks: [],
    cases: [],
    completions: [],
    screenshots: [],
    diagnostics: { consoleErrors: [], pageErrors: [] },
  };
  const output = path.dirname(options.output);
  const check = (name, value) => {
    assert(value, name);
    evidence.checks.push(name);
  };
  const click = (locator) => locator.evaluate((node) => node.click());
  const labels = JSON.parse(
    await fs.readFile(
      `src/i18n/resources/${options.locale}/settings.json`,
      "utf8",
    ),
  );
  const label = (key) => labels[`settings.browser.${key}`];
  const chatLabels = JSON.parse(
    await fs.readFile(
      `src/i18n/resources/${options.locale}/agent.json`,
      "utf8",
    ),
  );
  const emptyFinalMessage =
    chatLabels["agentChat.emptyFinalReply.errorMessage"];
  assert(
    typeof emptyFinalMessage === "string",
    "Missing empty-final locale key",
  );
  const stage = (name) => {
    evidence.stage = name;
    console.log(`[browser-history-access] stage=${name}`);
  };
  const snapshot = async (name) => {
    const file = path.join(output, `${name}.png`);
    const png = await (
      await app.browserWindow(page)
    ).evaluate(async (window) =>
      (await window.webContents.capturePage(undefined, { stayHidden: true }))
        .toPNG()
        .toString("base64"),
    );
    await fs.writeFile(file, Buffer.from(png, "base64"));
    evidence.screenshots.push(file);
  };
  const openSettings = async () => {
    await click(page.getByTestId("app-sidebar-nav-settings"));
    await click(page.getByTestId("settings-sidebar-tab-browser-use"));
    await page
      .locator("#browser-history-access-value")
      .waitFor({ state: "attached" });
  };
  const setAccess = async (access, denyBrowse = false) => {
    await openSettings();
    const trigger = page.locator(
      '[aria-labelledby="browser-history-access-label browser-history-access-value"]',
    );
    await waitFor(
      options,
      () => trigger.isEnabled(),
      Boolean,
      "History settings disabled",
    );
    await trigger.evaluate((node) => {
      node.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: 1,
          pointerType: "mouse",
        }),
      );
      node.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: 0,
          pointerType: "mouse",
        }),
      );
    });
    await click(
      page.getByRole("menuitemradio", {
        name: label(`history.${access}`),
        exact: true,
      }),
    );
    await waitFor(
      options,
      () => readConfigFromPage(page),
      (value) =>
        (value.config.browser_use?.allow_history_access === false
          ? "disabled"
          : (value.config.browser?.iabHistoryApprovalMode ?? "alwaysAsk")) ===
        access,
      "History preference did not commit",
    );
    if (denyBrowse) {
      await page
        .locator("#browser-agent-permissions select")
        .first()
        .evaluate((select) => {
          select.value = "deny";
          select.dispatchEvent(new Event("change", { bubbles: true }));
        });
      await waitFor(
        options,
        () => readConfigFromPage(page),
        (value) =>
          value.config.browser_use?.default_origin_policy?.access === "deny",
        "Browse deny did not commit",
      );
    }
    const config = await readConfigFromPage(page);
    check(
      `${access}-config-authority-${evidence.cases.length}`,
      (config.config.browser_use?.allow_history_access === false
        ? "disabled"
        : (config.config.browser?.iabHistoryApprovalMode ?? "alwaysAsk")) ===
        access &&
        config.config.browser_use?.default_origin_policy?.access === "deny",
    );
    await click(page.getByTestId("settings-back-button"));
    return waitFor(
      options,
      () => ctx.readBrowserWorkspaceState(page),
      (state) =>
        state?.webContentsId > 0 && state?.threadId === identity.threadId,
      "Canonical Browser did not return",
    );
  };
  const approvalIds = () =>
    page.evaluate(() => [...window.__historyAccessApprovals.ids]);
  await fs.mkdir(output, { recursive: true });
  try {
    stage("native-history-baseline");
    check(
      "real-electron-preload",
      await page.evaluate(
        () =>
          window.__LIME_ELECTRON__ === true &&
          Boolean(window.electronAPI?.invoke) &&
          window.electronAPI.devBridgeFallback === false,
      ),
    );
    const native = await app.evaluate(({ webContents }, id) => {
      const target = webContents.fromId(id);
      return {
        id: target.id,
        title: target.getTitle(),
        url: target.getURL(),
        debuggerAttached: target.debugger.isAttached(),
      };
    }, ctx.guiBeforeTurn.webContentsId);
    evidence.native = native;
    check(
      "controlled-http-native-page",
      /^http:\/\/127\.0\.0\.1:\d+\//u.test(native.url) &&
        Boolean(native.title) &&
        !native.debuggerAttached,
    );
    providerFixture.scenario.historyAccess.query = native.title;
    const baseline = await waitFor(
      options,
      () =>
        page.evaluate(
          (query) =>
            window.electronAPI.invoke("browser_history_list", {
              query,
              limit: 5,
            }),
          native.title,
        ),
      (value) =>
        value.entries?.some(
          (entry) => entry.url === native.url && entry.title === native.title,
        ),
      "Native navigation was not recorded in history",
    );
    evidence.baseline = { total: baseline.total, revision: baseline.revision };
    await page.evaluate((emptyFinalMessage) => {
      const ids = new Set();
      const emptyFinalToasts = new Set();
      const resolvedRequestWarnings = new Set();
      const observe = () => {
        document
          .querySelectorAll(
            '[data-interaction-kind="approval"][data-interaction-id]',
          )
          .forEach((node) => ids.add(node.getAttribute("data-interaction-id")));
        document.querySelectorAll("[data-sonner-toast]").forEach((node) => {
          if (node.textContent?.includes(emptyFinalMessage))
            emptyFinalToasts.add(node.textContent);
          if (node.textContent?.includes("serverRequest/resolved"))
            resolvedRequestWarnings.add(node.textContent);
        });
      };
      const observer = new MutationObserver(observe);
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true,
      });
      window.__historyAccessApprovals = {
        ids,
        observer,
        emptyFinalToasts,
        resolvedRequestWarnings,
      };
      observe();
    }, emptyFinalMessage);
    let previousPrompt = null;
    const turnIds = new Set();
    for (const entry of HISTORY_ACCESS_CASES) {
      stage(`${entry.name}-settings`);
      const before = await setAccess(entry.access, entry.name === "allowed");
      const approvalsBefore = await approvalIds();
      const readBefore = await appServerCallFromPage(page, "thread/read", {
        threadId: identity.threadId,
        includeTurns: true,
      });
      // Completion below is bound to a newly allocated turn, never an older terminal.
      const previousTurnId =
        readBefore.result?.thread?.turns?.at(-1)?.id ?? null;
      await sendPromptFromGui(page, options, `history-access-${entry.name}`, {
        expectedSessionId: identity.sessionId,
      });
      let prompt = null;
      if (entry.decision) {
        stage(`${entry.name}-approval`);
        prompt = await waitForApprovalPrompt(page, options, previousPrompt);
        check(
          `${entry.name}-one-use-decisions`,
          prompt.decisions.includes("allow_once") &&
            prompt.decisions.includes("decline") &&
            !prompt.decisions.includes("allow_for_session"),
        );
        check(
          `${entry.name}-no-early-provider-history`,
          !providerFixture.scenario.historyAccess.results[entry.name],
        );
        await snapshot(`${entry.name}-approval`);
        if (entry.name === "policy-revoked") {
          // A second config writer preserves the mounted approval and active turn.
          const config = await readConfigFromPage(page);
          await writeConfigEditsFromPage(page, {
            expectedVersion: config.version,
            edits: [
              {
                keyPath: "browser_use",
                mergeStrategy: "replace",
                value: {
                  ...config.config.browser_use,
                  allow_history_access: false,
                },
              },
            ],
          });
          check(
            "policy-revoked-authoritative-config",
            (await readConfigFromPage(page)).config.browser_use
              ?.allow_history_access === false,
          );
          check(
            "policy-revoked-same-live-approval",
            (await waitForApprovalPrompt(page, options)).interactionId ===
              prompt.interactionId,
          );
        }
        if (entry.name === "revoked") {
          await setAccess("disabled");
          // This product route interrupts the active turn on settings navigation.
          const terminal = await ctx.waitForTerminalThread(
            page,
            options,
            identity.threadId,
            ctx.requestLog,
          );
          const items =
            terminal.turn.items?.filter(
              (item) =>
                item.type === "dynamicToolCall" &&
                item.namespace === "browser" &&
                item.tool === "history",
            ) ?? [];
          check(
            "revoked-explicit-interrupted-terminal",
            terminal.turn.id !== previousTurnId &&
              terminal.turn.status === "interrupted",
          );
          check(
            "revoked-no-canonical-history",
            items.length === 1 &&
              items[0].success !== true &&
              !(JSON.stringify(items[0].contentItems) ?? "").includes(
                native.url,
              ),
          );
          check(
            "revoked-no-provider-history",
            !Object.hasOwn(
              providerFixture.scenario.historyAccess.results,
              entry.name,
            ),
          );
          const pending = await app.evaluate(() => {
            const read = globalThis.__appServerE2E?.pendingBrowserApprovals;
            return {
              available: typeof read === "function",
              count: typeof read === "function" ? read().length : null,
            };
          });
          check(
            "revoked-no-native-approval-token",
            pending.available && pending.count === 0,
          );
          const newApprovals = (await approvalIds()).filter(
            (id) => !approvalsBefore.includes(id),
          );
          check(
            "revoked-single-pending-approval",
            newApprovals.length === 1 &&
              newApprovals[0] === prompt.interactionId,
          );
          evidence.cases.push({
            name: entry.name,
            access: "disabled",
            turnId: terminal.turn.id,
            turnStatus: terminal.turn.status,
            approvals: newApprovals.length,
            providerResult: null,
            pendingNativeTokens: pending.count,
          });
          continue;
        }
        await clickApprovalDecision(page, prompt.interactionId, entry.decision);
        previousPrompt = prompt.interactionId;
      }
      stage(`${entry.name}-canonical-terminal`);
      await waitFor(
        options,
        () => providerFixture.scenario.historyAccess.results[entry.name],
        Boolean,
        "Provider did not receive the history result",
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
          value.turn?.id !== previousTurnId &&
          value.turn?.status === "completed" &&
          JSON.stringify(value.turn).includes(
            `HISTORY_ACCESS_DONE_${entry.name}`,
          ),
        "Canonical turn missing history result",
      );
      const result = providerFixture.scenario.historyAccess.results[entry.name];
      const completion = {
        name: entry.name,
        threadId: identity.threadId,
        turnId: terminal.turn.id,
        items: terminal.turn.items?.map(({ id, type, phase, text }) => ({
          id,
          type,
          phase,
          text,
        })),
        gui: await waitFor(
          options,
          () =>
            page.evaluate(
              (marker) => ({
                visibleFinal: [
                  ...document.querySelectorAll(
                    '[data-testid="message-turn-group"]',
                  ),
                ].some((node) => node.textContent?.includes(marker)),
                emptyFinalToasts: [
                  ...window.__historyAccessApprovals.emptyFinalToasts,
                ],
              }),
              `HISTORY_ACCESS_DONE_${entry.name}`,
            ),
          (value) => value.visibleFinal || value.emptyFinalToasts.length > 0,
          "Renderer did not settle completion",
        ),
      };
      evidence.completions.push(completion);
      const guiTerminal = await waitForGuiChatCompleted(page, options, {
        prompt: `history-access-${entry.name}`,
        doneText: `HISTORY_ACCESS_DONE_${entry.name}`,
        summaryText: `HISTORY_ACCESS_DONE_${entry.name}`,
        requiredVisibleTexts: [`HISTORY_ACCESS_DONE_${entry.name}`],
        expectedIdentity: {
          sessionId: identity.sessionId,
          turnId: terminal.turn.id,
        },
      });
      completion.guiTerminal = guiTerminal.completionScope;
      Object.assign(
        completion.gui,
        await page.evaluate(() => ({
          emptyFinalToasts: [
            ...window.__historyAccessApprovals.emptyFinalToasts,
          ],
          resolvedRequestWarnings: [
            ...window.__historyAccessApprovals.resolvedRequestWarnings,
          ],
        })),
      );
      await snapshot(`${entry.name}-completed`);
      check(`${entry.name}-visible-final`, completion.gui.visibleFinal);
      check(
        `${entry.name}-gui-completed`,
        guiTerminal.completionScope.runtimeTurnStatus === "completed",
      );
      check(
        `${entry.name}-no-empty-final-toast`,
        completion.gui.emptyFinalToasts.length === 0,
      );
      check(
        `${entry.name}-no-unprojected-request-warning`,
        completion.gui.resolvedRequestWarnings.length === 0,
      );
      const toolItems =
        terminal.turn.items?.filter(
          (item) =>
            item.type === "dynamicToolCall" &&
            item.namespace === "browser" &&
            item.tool === "history",
        ) ?? [];
      check(
        `${entry.name}-canonical-tool-result`,
        toolItems.length === 1 &&
          toolItems[0].success === entry.approved &&
          (entry.approved
            ? JSON.stringify(toolItems[0].contentItems).includes(native.title)
            : !(JSON.stringify(toolItems[0].contentItems) ?? "").includes(
                native.url,
              )),
      );
      const newApprovals = (await approvalIds()).filter(
        (id) => !approvalsBefore.includes(id),
      );
      const after = await ctx.readBrowserWorkspaceState(page);
      check(
        `${entry.name}-exact-approval-count`,
        newApprovals.length === (entry.decision ? 1 : 0),
      );
      check(
        `${entry.name}-provider-result`,
        entry.approved
          ? result.completed && result.hasHistory && result.hasData
          : !result.completed &&
              !result.hasHistory &&
              !result.hasData &&
              result.rejected,
      );
      check(
        `${entry.name}-unique-canonical-turn`,
        !turnIds.has(terminal.turn.id),
      );
      turnIds.add(terminal.turn.id);
      check(
        `${entry.name}-same-browser-owner`,
        before.sessionId === ctx.guiBeforeTurn.sessionId &&
          before.tabId === ctx.guiBeforeTurn.tabId &&
          before.threadId === identity.threadId &&
          after.tabId === before.tabId &&
          after.threadId === before.threadId &&
          after.controlOwner !== "agent",
      );
      if (entry.approved)
        check(
          `${entry.name}-exact-tool-route`,
          result.state?.threadId === identity.threadId &&
            result.state?.tabId === before.tabId &&
            result.state?.webContentsId === before.webContentsId &&
            result.state?.controlOwner === "user" &&
            result.state?.activeTurnId === null,
        );
      check(
        `${entry.name}-no-page-debugger`,
        await app.evaluate(({ webContents }, id) => {
          const target = webContents.fromId(id);
          return Boolean(
            target && !target.isDestroyed() && !target.debugger.isAttached(),
          );
        }, after.webContentsId),
      );
      evidence.cases.push({
        name: entry.name,
        access: entry.access,
        turnId: terminal.turn.id,
        turnStatus: terminal.turn.status,
        browserSessionId: before.sessionId,
        tabId: before.tabId,
        webContentsId: before.webContentsId,
        result,
        approvals: newApprovals.length,
        interactionId: prompt?.interactionId ?? null,
        canonicalItemTypes: terminal.turn.items?.map((item) => item.type),
      });
    }
    const traces = ctx.readInvokeTrace();
    const calls = traces.flatMap((entry) =>
      entry.command !== "app_server_handle_json_lines"
        ? []
        : (entry.args_preview?.request?.lines ?? []).flatMap((line) => {
            try {
              const message =
                typeof line === "string" ? JSON.parse(line) : line;
              return typeof message?.method === "string"
                ? [
                    {
                      method: message.method,
                      requestId: message.id ?? null,
                      transport: entry.transport,
                      status: entry.status,
                    },
                  ]
                : [];
            } catch {
              return [];
            }
          }),
    );
    evidence.invoke = {
      traceCount: traces.length,
      calls,
      mockFallbackHitCount: traces.filter(
        (entry) =>
          entry.mock === true ||
          entry.mockFallback === true ||
          [
            entry.transport,
            entry.source,
            entry.fallback,
            entry.fallbackMode,
          ].some((value) => typeof value === "string" && /mock/i.test(value)),
      ).length,
    };
    evidence.providerRequestCount = providerFixture.requests.length;
    check(
      "no-production-mock-fallback",
      evidence.invoke.mockFallbackHitCount === 0,
    );
    for (const method of [
      "config/read",
      "config/batchWrite",
      "turn/start",
      "thread/read",
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
    evidence.host = await app.evaluate(
      () => globalThis.__browserDesignHostEvidence,
    );
    check(
      "hidden-real-host-no-preload-errors",
      evidence.host?.unexpectedShowEvents === 0 &&
        evidence.host?.preloadErrors.length === 0,
    );
    evidence.status = "pass";
    evidence.claimBoundary =
      "四个真实 GUI/config/runtime/provider 历史查询结果，同 live turn 的第二配置写者经真实 config/batchWrite 撤销后拒绝旧批准，以及设置导航中断待审批回合后的 canonical interrupted、原生 token 清除与无 provider 历史披露。第二配置写者不是 GUI 设置交互；在途 IO 丢弃由集成测试证明。不是完整 S15、跨导航保持审批、物理输入或 live provider 证据。";
    evidence.failedAssertions = [];
    return evidence;
  } catch (error) {
    evidence.error = String(error);
    evidence.providerResults = providerFixture.scenario.historyAccess.results;
    evidence.canonicalFailureState = await appServerCallFromPage(
      page,
      "thread/read",
      { threadId: identity.threadId, includeTurns: true },
    )
      .then((response) => ({
        threadId: response.result?.thread?.id,
        turns: response.result?.thread?.turns?.map((turn) => ({
          id: turn.id,
          status: turn.status,
          itemTypes: turn.items?.map((item) => item.type),
        })),
      }))
      .catch((error) => ({ error: String(error) }));
    evidence.failureProjection = await page
      .evaluate(() => ({
        locale: document.documentElement.lang,
        historyValue: document.getElementById("browser-history-access-value")
          ?.textContent,
        menuItems: [...document.querySelectorAll('[role="menuitemradio"]')].map(
          (node) => node.textContent,
        ),
        approvals: [
          ...document.querySelectorAll('[data-interaction-kind="approval"]'),
        ].map((node) => node.textContent?.slice(0, 500)),
      }))
      .catch(() => null);
    await snapshot("failure").catch(() => undefined);
    await fs.writeFile(
      options.output.replace(/\.json$/u, "-failure.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
    throw error;
  } finally {
    await page
      .evaluate(() => window.__historyAccessApprovals?.observer.disconnect())
      .catch(() => undefined);
  }
}
