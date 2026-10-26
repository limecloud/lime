import http from "node:http";
import { CDP_TARGET_CASES } from "./browser-cdp-target-provider.mjs";
import { sendPromptFromGui } from "../lib/chat-fixture/gui-actions.mjs";
import { waitForGuiChatCompleted } from "../lib/chat-fixture/gui-completion-waits.mjs";
import {
  clickApprovalDecision,
  waitForApprovalPrompt,
} from "./browser-runtime-electron-gate-b-approval.mjs";
import { waitForBrowserAnnotationState as waitFor } from "./browser-runtime-electron-gate-b-annotation-diagnostics.mjs";
import { runBrowserCdpSessionScenario } from "./browser-runtime-electron-gate-b-cdp-sessions.mjs";

/** Real native cross-site frame; tool results still originate solely in the runtime's tool calls. */
export async function runBrowserCdpTargetScenario(
  ctx,
  evidence,
  check,
  snapshot,
) {
  const { app, page, options, identity, providerFixture } = ctx;
  const before = await ctx.readBrowserWorkspaceState(page);
  const server = http.createServer((request, response) => {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(
      request.url === "/frame"
        ? "<!doctype html><title>CDP child frame</title><p>Owned cross-site frame</p>"
        : `<!doctype html><title>CDP target page</title><h1>CDP targets</h1><iframe src="http://localhost:${server.address().port}/frame"></iframe>`,
    );
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}/targets`;
  const childUrl = `http://localhost:${server.address().port}/frame`;
  evidence.targetCases = [];
  try {
    console.log("[browser-cdp] stage=target-fixture-navigation");
    await app.evaluate(
      async ({ webContents }, { id, url }) => {
        const contents = webContents.fromId(id);
        if (!contents || contents.isDestroyed())
          throw new Error("CDP target native page is unavailable");
        await contents.loadURL(url);
      },
      { id: before.webContentsId, url },
    );
    await waitFor(
      options,
      () =>
        app.evaluate(({ webContents }, id) => {
          const contents = webContents.fromId(id);
          return (
            contents?.mainFrame.framesInSubtree.map((frame) => frame.url) ?? []
          );
        }, before.webContentsId),
      (urls) => urls.includes(childUrl),
      "Native cross-site frame did not load",
    );
    await waitFor(
      options,
      () => ctx.readBrowserWorkspaceState(page),
      (state) => state.address === url,
      "Target page native state did not reach the GUI",
    );
    for (const entry of CDP_TARGET_CASES) {
      console.log(`[browser-cdp] stage=${entry.name}`);
      if (entry.name === "frame-session") {
        await runBrowserCdpSessionScenario(
          ctx,
          evidence,
          check,
          snapshot,
          before,
          childUrl,
        );
        continue;
      }
      const promptText = `browser-cdp-${entry.name}`;
      await sendPromptFromGui(page, options, promptText, {
        expectedSessionId: identity.sessionId,
      });
      const prompt = await waitForApprovalPrompt(page, options);
      check(
        `${entry.name}-canonical-approval`,
        prompt.summary.includes(entry.method),
      );
      check(
        `${entry.name}-no-result-before-approval`,
        !providerFixture.scenario.cdp.targets.results[entry.name],
      );
      const claimed = providerFixture.scenario.cdp.targets.claimed[entry.name];
      check(
        `${entry.name}-same-native-owner`,
        claimed?.tabId === before.tabId &&
          claimed?.webContentsId === before.webContentsId &&
          claimed?.threadId === identity.threadId,
      );
      if (entry.method === "Target.closeTarget")
        await snapshot("target-close-approval");
      await clickApprovalDecision(page, prompt.interactionId, "allow_once");
      const result = await waitFor(
        options,
        () => providerFixture.scenario.cdp.targets.results[entry.name],
        Boolean,
        "Runtime did not receive the Target command result",
      );
      check(`${entry.name}-runtime-result`, result.success);
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
          value.turn?.id === claimed.activeTurnId &&
          value.turn.status === "completed" &&
          JSON.stringify(value.turn).includes(`BROWSER_CDP_DONE_${entry.name}`),
        "Target canonical turn did not complete",
      );
      await waitForGuiChatCompleted(page, options, {
        prompt: promptText,
        doneText: `BROWSER_CDP_DONE_${entry.name}`,
        summaryText: `BROWSER_CDP_DONE_${entry.name}`,
        requiredVisibleTexts: [`BROWSER_CDP_DONE_${entry.name}`],
        expectedIdentity: {
          sessionId: identity.sessionId,
          turnId: terminal.turn.id,
        },
      });
      const tools =
        terminal.turn.items?.filter(
          (item) =>
            item.type === "dynamicToolCall" &&
            item.namespace === "browser" &&
            item.tool === "executeCdpCommand",
        ) ?? [];
      check(
        `${entry.name}-single-canonical-tool`,
        tools.length === 1 && tools[0].success === true,
      );
      const targetId = `browser-use-iab-tab:${before.tabId}`;
      if (entry.method === "Target.getTargetInfo") {
        check(
          "target-info-current-identity",
          result.data.targetInfo?.targetId === targetId &&
            result.data.targetInfo.tabId === before.tabId &&
            result.data.targetInfo.url === url,
        );
        check(
          "target-info-no-debugger-attach",
          result.data.targetInfo.attached === false,
        );
      } else if (entry.method === "Target.getTargets") {
        const targets = result.data.targetInfos;
        check(
          "target-list-current-logical-page",
          targets.some(
            (target) =>
              target.targetId === targetId &&
              target.type === "page" &&
              target.tabId === before.tabId,
          ),
        );
        check(
          "target-list-native-cross-site-frame",
          targets.some(
            (target) =>
              target.type === "iframe" &&
              target.tabId === before.tabId &&
              target.url === childUrl &&
              target.targetId !== targetId,
          ),
        );
        check(
          "target-list-no-unrelated-pages",
          targets
            .filter((target) => target.type === "page")
            .every((target) => target.tabId === before.tabId),
        );
      } else {
        check(
          "target-close-success",
          result.data.success === true && result.tab === null,
        );
        await waitFor(
          options,
          () =>
            app.evaluate(
              ({ webContents }, id) =>
                !webContents.fromId(id) || webContents.fromId(id).isDestroyed(),
              before.webContentsId,
            ),
          Boolean,
          "Target close did not destroy its native page",
        );
        const state = await waitFor(
          options,
          () => ctx.readBrowserWorkspaceState(page),
          (state) => state.viewId !== before.viewId,
          "Closed Target remains in the GUI",
        );
        check("target-close-gui-removal", state.viewId !== before.viewId);
        check(
          "target-close-no-pending-tokens",
          (
            await app.evaluate(() =>
              globalThis.__appServerE2E.pendingBrowserApprovals(),
            )
          ).length === 0,
        );
        await snapshot("target-close-completed");
      }
      evidence.targetCases.push({
        name: entry.name,
        turnId: terminal.turn.id,
        nativeWebContentsId: before.webContentsId,
        canonicalToolId: tools[0].id,
        result,
      });
    }
  } finally {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  }
}
