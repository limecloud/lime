import { readFile } from "node:fs/promises";
import { sendPromptFromGui } from "../lib/chat-fixture/gui-actions.mjs";
import { waitForGuiChatCompleted } from "../lib/chat-fixture/gui-completion-waits.mjs";
import {
  clickApprovalDecision,
  waitForApprovalPrompt,
} from "./browser-runtime-electron-gate-b-approval.mjs";
import { waitForBrowserAnnotationState as waitFor } from "./browser-runtime-electron-gate-b-annotation-diagnostics.mjs";

/** One canonical GUI turn; native reads are observations, never tool-result replacements. */
export async function runBrowserCdpSessionScenario(
  ctx,
  evidence,
  check,
  snapshot,
  before,
  childUrl,
) {
  const { app, page, options, identity, providerFixture } = ctx;
  const state = providerFixture.scenario.cdp.sessions;
  const readNative = () =>
    app.evaluate(
      async ({ webContents }, { id, childUrl }) => {
        const contents = webContents.fromId(id);
        if (!contents || contents.isDestroyed())
          throw new Error("Frame session page is unavailable");
        const child = contents.mainFrame.framesInSubtree.find(
          (frame) => frame.url === childUrl,
        );
        if (!child) throw new Error("Frame session child is unavailable");
        const expression =
          "Number(document.documentElement.dataset.cdpSessionMutations || '0')";
        return {
          main: await contents.mainFrame.executeJavaScript(expression),
          child: await child.executeJavaScript(expression),
          attached: contents.debugger.isAttached(),
          listeners: contents.debugger.listenerCount("message"),
        };
      },
      { id: before.webContentsId, childUrl },
    );
  const initial = await readNative();
  check("session-initially-detached", !initial.attached);
  check(
    "session-initial-mutations-zero",
    initial.main === 0 && initial.child === 0,
  );
  const promptText = "browser-cdp-frame-session";
  await sendPromptFromGui(page, options, promptText, {
    expectedSessionId: identity.sessionId,
  });
  let previousInteractionId = null;
  const observations = [];
  for (const [step, method, expectedBefore, expectedAfter] of [
    ["list", "Target.getTargets", 0, 0],
    ["attach", "Target.attachToTarget", 0, 0],
    ["mutate", "Runtime.evaluate", 0, 1],
    ["read", "Runtime.evaluate", 1, 1],
    ["detach", "Target.detachFromTarget", 1, 1],
  ]) {
    console.log(`[browser-cdp] stage=frame-session-${step}`);
    const prompt = await waitForApprovalPrompt(
      page,
      options,
      previousInteractionId,
    );
    previousInteractionId = prompt.interactionId;
    check(
      `session-${step}-canonical-approval`,
      prompt.summary.includes(method),
    );
    check(`session-${step}-no-result-before-approval`, !state.results[step]);
    const nativeBefore = await readNative();
    check(
      `session-${step}-no-premature-mutation`,
      nativeBefore.main === 0 && nativeBefore.child === expectedBefore,
    );
    if (step === "list") {
      check(
        "session-same-native-owner",
        state.claimed?.tabId === before.tabId &&
          state.claimed?.webContentsId === before.webContentsId &&
          state.claimed?.threadId === identity.threadId,
      );
      check("session-no-attach-before-first-approval", !nativeBefore.attached);
    }
    if (step === "mutate") await snapshot("frame-session-mutation-approval");
    await clickApprovalDecision(page, prompt.interactionId, "allow_once");
    const result = await waitFor(
      options,
      () => state.results[step],
      Boolean,
      `Runtime did not receive frame session ${step}`,
    );
    check(`session-${step}-runtime-result`, result.success);
    const nativeAfter = await readNative();
    check(
      `session-${step}-only-child-mutation`,
      nativeAfter.main === 0 && nativeAfter.child === expectedAfter,
    );
    if (step === "attach")
      check(
        "session-native-id-returned",
        typeof state.sessionId === "string" &&
          Boolean(state.sessionId) &&
          Boolean(state.targetId),
      );
    if (step === "mutate" || step === "read")
      check(
        `session-${step}-same-child-result`,
        result.data.result?.value === 1,
      );
    observations.push({
      step,
      method,
      interactionId: prompt.interactionId,
      nativeBefore,
      nativeAfter,
      result,
    });
  }
  const stale = await waitFor(
    options,
    () => state.results.stale,
    Boolean,
    "Runtime did not reject detached session",
  );
  check("session-stale-selection-rejected", !stale.success && stale.rejected);
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
      value.turn?.id === state.claimed.activeTurnId &&
      value.turn.status === "completed" &&
      JSON.stringify(value.turn).includes("BROWSER_CDP_DONE_frame-session"),
    "Frame session canonical turn did not complete",
  );
  await waitForGuiChatCompleted(page, options, {
    prompt: promptText,
    doneText: "BROWSER_CDP_DONE_frame-session",
    summaryText: "BROWSER_CDP_DONE_frame-session",
    requiredVisibleTexts: ["BROWSER_CDP_DONE_frame-session"],
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
        ["executeCdpCommand", "attachTarget", "detachTarget"].includes(
          item.tool,
        ),
    ) ?? [];
  check(
    "session-canonical-command-results",
    tools.length === 6 &&
      tools.slice(0, 5).every((item) => item.success === true) &&
      tools[5].success === false,
  );
  const final = await readNative();
  check(
    "session-terminal-detaches-and-clears-listeners",
    !final.attached && final.listeners === initial.listeners,
  );
  check(
    "session-stale-command-has-no-side-effect",
    final.main === 0 && final.child === 1,
  );
  check(
    "session-no-pending-tokens",
    (
      await app.evaluate(() =>
        globalThis.__appServerE2E.pendingBrowserApprovals(),
      )
    ).length === 0,
  );
  // Inspect the real canonical rows; opening disclosure controls is synthetic DOM input.
  const turnSelector = `[data-testid="conversation-turn-timeline"][data-runtime-turn-id=${JSON.stringify(terminal.turn.id)}]`;
  const turn = page.locator(turnSelector);
  await turn
    .locator('[data-testid^="message-list-historical-timeline-preview:"]')
    .evaluateAll((buttons) => buttons.forEach((button) => button.click()));
  await waitFor(
    options,
    () => turn.locator('[data-testid="agent-thread-flow"]').count(),
    (count) => count > 0,
    `Canonical turn ${terminal.turn.id} process did not expand`,
  );
  await turn
    .locator('details[data-testid^="agent-thread-block:"]')
    .evaluateAll((details) => {
      for (const detail of details) {
        if (!detail.open) detail.querySelector("summary")?.click();
      }
    });
  const presentationState = await waitFor(
    options,
    () =>
      page.evaluate(
        ({ ids, turnSelector }) => {
          const selected = new Set(ids);
          const turn = document.querySelector(turnSelector);
          const allRows = Array.from(
            turn?.querySelectorAll('[data-testid="tool-call-row"]') || [],
          );
          const rows = allRows
            .filter((row) =>
              selected.has(row.getAttribute("data-tool-call-id")),
            )
            .map((row) => ({
              id: row.getAttribute("data-tool-call-id"),
              name: row.getAttribute("data-tool-name"),
              status: row.getAttribute("data-tool-status"),
              text: row.textContent || "",
              terminalIcon: Boolean(row.querySelector(".lucide-terminal")),
              block:
                row
                  .closest('[data-testid^="agent-thread-block:"]')
                  ?.getAttribute("data-testid") || null,
              group:
                row
                  .closest('details[data-testid^="agent-thread-block:"]')
                  ?.querySelector("summary")?.textContent || null,
            }));
          return {
            expectedIds: ids,
            observedIds: allRows.map((row) =>
              row.getAttribute("data-tool-call-id"),
            ),
            turnFound: Boolean(turn),
            rows,
          };
        },
        { ids: tools.map((item) => item.id), turnSelector },
      ),
    (state) => state.rows.length === tools.length,
    "Canonical frame-session tool rows are not visible after disclosure",
  );
  const presentation = presentationState.rows;
  evidence.sessionPresentation = presentationState;
  const localeCopy = JSON.parse(
    await readFile(
      new URL(
        `../../src/i18n/resources/${options.locale}/agent.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const browserTitle = localeCopy["agentChat.toolBatch.browser.title"];
  check(
    "session-browser-presentation-keeps-canonical-names",
    presentation.every((row) =>
      tools.some((item) => item.id === row.id && item.tool === row.name),
    ),
  );
  check(
    "session-browser-presentation-has-no-terminal-icons",
    presentation.every((row) => !row.terminalIcon),
  );
  check(
    "session-browser-presentation-has-no-raw-tool-headlines",
    presentation.every(
      (row) =>
        !/attach\s*Target|detach\s*Target|execute\s*Cdp\s*Command/i.test(
          row.text,
        ),
    ),
  );
  check(
    "session-browser-presentation-uses-page-subjects",
    presentation
      .slice(0, 5)
      .every((row) => /页面|頁面|Page|ページ|페이지/.test(row.text)),
  );
  check(
    "session-browser-presentation-uses-canonical-browser-group",
    typeof browserTitle === "string" &&
      browserTitle.length > 0 &&
      presentation.every(
        (row) =>
          /^agent-thread-block:\d+:process(?::details)?$/.test(
            row.block || "",
          ) && row.group?.includes(browserTitle),
      ),
  );
  await snapshot("frame-session-completed");
  evidence.sessionCase = {
    turnId: terminal.turn.id,
    nativeWebContentsId: before.webContentsId,
    targetId: state.targetId,
    sessionId: state.sessionId,
    initial,
    observations,
    final,
    stale,
    canonicalToolIds: tools.map((item) => item.id),
    presentation,
  };
}
