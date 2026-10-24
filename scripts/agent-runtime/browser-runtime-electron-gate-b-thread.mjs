import {
  clickApprovalDecision,
  readMutationCount,
  waitForApprovalPrompt,
} from "./browser-runtime-electron-gate-b-approval.mjs";
import { readInvokeDiagnostics } from "./browser-runtime-electron-gate-b-cancel.mjs";
import { parseJsonRpcRequestsFromInvokeTrace } from "../electron/lib/mcp-config-fixture-evidence.mjs";
import { clickBrowserPageAsUser } from "./browser-runtime-electron-gate-b-user-control.mjs";
import { sendPromptFromGui } from "./claw-chat-current-fixture-gui-actions.mjs";
import {
  assert,
  sanitizeJson,
  sleep,
} from "./claw-chat-current-fixture-utils.mjs";

/** Follow-up turns use the real provider/runtime path, without direct tool calls. */
export function createBrowserReceiptResponses(scenario, helpers) {
  const {
    extractBrowserState,
    extractBrowserObservation,
    toolResultFromRequest,
  } = helpers;
  scenario.receiptTurns = ["retained", "revoked"].map((name) => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    return { name, gate, release, claimed: null, observed: null };
  });
  return scenario.receiptTurns.flatMap((turn) => [
    {
      type: "tool_call",
      id: `call-browser-${turn.name}-open-tabs`,
      name: "browser__openTabs",
      arguments: {},
    },
    ({ body }) => {
      const state = extractBrowserState(toolResultFromRequest(body));
      assert(
        state?.tabId,
        "Follow-up openTabs did not return the original tab",
      );
      assert(
        state.tabId === scenario.initial?.state?.tabId,
        "Follow-up openTabs changed the Browser tab",
      );
      return {
        type: "tool_call",
        id: `call-browser-${turn.name}-claim`,
        name: "browser__claimTab",
        arguments: {
          tabId: state.tabId,
          title: state.title,
          url: state.url,
          pageRevision: state.pageRevision,
        },
      };
    },
    ({ body }) => {
      const state = extractBrowserState(toolResultFromRequest(body));
      assert(
        state?.activeTurnId,
        "Follow-up claim did not acquire turn control",
      );
      turn.claimed = state;
      return {
        type: "tool_call",
        id: `call-browser-${turn.name}-observe`,
        name: "browser__observe",
        arguments: { tabId: state.tabId },
      };
    },
    async ({ body }) => {
      const result = toolResultFromRequest(body);
      const state = extractBrowserState(result);
      const observation = extractBrowserObservation(result);
      assert(
        state?.activeTurnId && observation?.snapshotId,
        "Follow-up observe did not return an active page snapshot",
      );
      turn.observed = {
        state,
        snapshotId: observation.snapshotId,
        pageRevision: observation.pageRevision,
      };
      await turn.gate;
      return {
        type: "text",
        content: `BROWSER_THREAD_RECEIPT_${turn.name}_DONE`,
      };
    },
  ]);
}

async function readPending(app) {
  return app.evaluate(() => {
    const control = globalThis.__appServerE2E;
    if (!control?.pendingBrowserApprovals)
      throw new Error("Native Browser approval inspection unavailable");
    return control.pendingBrowserApprovals();
  });
}

export function browserReceiptTurnStarts(trace) {
  return parseJsonRpcRequestsFromInvokeTrace(JSON.stringify(trace))
    .filter((call) => call.method === "turn/start")
    .map((call) => ({
      requestId: call.id,
      method: call.method,
      threadId: call.params.threadId,
      transport: call.transport,
      status: call.status,
    }));
}

async function sendNativeUserClick(app, webContentsId, options) {
  const beforeMutation = await readMutationCount(app, webContentsId);
  const input = await clickBrowserPageAsUser(app, webContentsId);
  const startedAt = Date.now();
  while (Date.now() - startedAt < options.timeoutMs) {
    const afterMutation = await readMutationCount(app, webContentsId);
    if (afterMutation === beforeMutation + 1)
      return {
        ...input,
        source: "sendInputEvent",
        beforeMutation,
        afterMutation,
      };
    await sleep(options.intervalMs);
  }
  throw new Error("Native user click did not reach the same Browser page");
}

/** Reuse is valid across turns; native user input must revoke the same receipt. */
export async function runBrowserReceiptTurns(context) {
  const {
    app,
    page,
    options,
    sessionOptions,
    identity,
    providerFixture,
    requestLog,
    evidence,
    consoleErrors,
    pageErrors,
    readBrowserWorkspaceState,
    readBrowserDebuggerState,
    readInvokeTrace,
    waitForBrowserWorkspaceState,
    waitForScenarioValue,
    waitForTerminalThread,
    logStage,
  } = context;
  const turns = [];
  let nativeInput = null;
  let renewedApproval = null;
  for (const turn of providerFixture.scenario.receiptTurns) {
    logStage(`thread-receipt-${turn.name}`);
    if (turn.name === "revoked") {
      nativeInput = await sendNativeUserClick(
        app,
        evidence.browser.released.webContentsId,
        options,
      );
    }
    const before = await readBrowserWorkspaceState(page);
    const debuggerBefore = await readBrowserDebuggerState(
      app,
      before.webContentsId,
    );
    assert(
      before.activeTurnId === null && !debuggerBefore.attached,
      "A thread receipt retained native control between turns",
    );
    await sendPromptFromGui(
      page,
      sessionOptions,
      "请重新取得同一 Browser 标签的控制并观察页面，然后结束本回合。",
      { expectedSessionId: identity.sessionId },
    );
    if (turn.name === "revoked") {
      const prompt = await waitForApprovalPrompt(page, options);
      const pending = await readPending(app);
      assert(
        pending.length === 1 && pending[0].kind === "browse",
        "Native user input did not require a fresh browse approval",
      );
      const request = pending[0];
      assert(
        request.accessApprovalLifetime === "thread" &&
          request.threadId === identity.threadId &&
          request.tool === "claimTab" &&
          request.policyRevision ===
            evidence.browse.afterPolicyChange.lineage.policyRevision &&
          prompt.summary.includes(evidence.browse.origin),
        "Renewed browse approval changed its scope",
      );
      const debuggerPending = await readBrowserDebuggerState(
        app,
        request.webContentsId,
      );
      assert(
        !debuggerPending.attached,
        "Renewed claim attached before approval",
      );
      const decision = await clickApprovalDecision(
        page,
        prompt.interactionId,
        "allow_once",
      );
      renewedApproval = {
        prompt,
        decision,
        threadId: request.threadId,
        turnId: request.turnId,
        browserSessionId: request.browserSessionId,
        tabId: request.tabId,
        viewId: request.viewId,
        webContentsId: request.webContentsId,
        origin: request.origin,
        accessApprovalLifetime: request.accessApprovalLifetime,
        policyRevision: request.policyRevision,
        debuggerAttachedBeforeApproval: debuggerPending.attached,
      };
    }
    const observed = await waitForScenarioValue(
      options,
      () => turn.observed,
      `Browser receipt ${turn.name} observation`,
    );
    assert(
      (await readPending(app)).length === 0,
      "Retained receipt unexpectedly requested approval",
    );
    const controlled = await waitForBrowserWorkspaceState(
      page,
      options,
      (state) =>
        state.activeTurnId === observed.state.activeTurnId &&
        state.controlOwner === "agent" &&
        state.webContentsId === before.webContentsId,
      "Follow-up turn did not project Agent control",
    );
    const debuggerControlled = await readBrowserDebuggerState(
      app,
      controlled.webContentsId,
    );
    turn.release();
    const terminal = await waitForTerminalThread(
      page,
      options,
      identity.threadId,
      requestLog,
    );
    const released = await waitForBrowserWorkspaceState(
      page,
      options,
      (state) =>
        state.activeTurnId === null &&
        state.controlOwner === "released" &&
        state.webContentsId === before.webContentsId,
      "Follow-up receipt turn did not release native control",
    );
    const debuggerReleased = await readBrowserDebuggerState(
      app,
      released.webContentsId,
    );
    turns.push({
      name: turn.name,
      before,
      claimed: turn.claimed,
      observed,
      controlled,
      terminalTurnId: terminal.turn?.id ?? terminal.turn?.turnId,
      terminalStatus: terminal.turn?.status ?? terminal.turn?.state,
      released,
      debugger: {
        before: debuggerBefore,
        controlled: debuggerControlled,
        released: debuggerReleased,
      },
    });
  }
  const initialTurnId = evidence.browser.controlled.activeTurnId;
  const turnIds = [
    initialTurnId,
    ...turns.map((turn) => turn.controlled.activeTurnId),
  ];
  const expected = evidence.browser.controlled;
  const invoke = await readInvokeDiagnostics(page);
  const turnStarts = browserReceiptTurnStarts(readInvokeTrace());
  const checks = {
    threadReceiptReusedAcrossCanonicalTurns:
      turns[0]?.name === "retained" &&
      new Set(turnIds).size === 3 &&
      turnIds.every(Boolean),
    sameThreadSessionTabAndNativeView: turns.every(
      (turn) =>
        turn.observed.state.browserSessionId === expected.sessionId &&
        ["threadId", "tabId", "viewId", "webContentsId"].every(
          (key) => turn.observed.state[key] === expected[key],
        ),
    ),
    receiptNeverRetainsControlBetweenTurns: turns.every(
      (turn) =>
        turn.before.activeTurnId === null &&
        !turn.debugger.before.attached &&
        turn.debugger.controlled.attached &&
        !turn.debugger.released.attached,
    ),
    followUpTurnsCompleteAndRelease: turns.every(
      (turn) =>
        turn.terminalTurnId === turn.controlled.activeTurnId &&
        String(turn.terminalStatus).toLowerCase() === "completed" &&
        turn.released.activeTurnId === null,
    ),
    nativeUserInputRevokesThreadReceipt:
      nativeInput?.webContentsId === expected.webContentsId &&
      nativeInput?.clicked === true &&
      nativeInput?.afterMutation === nativeInput?.beforeMutation + 1 &&
      renewedApproval?.turnId === turnIds[2] &&
      renewedApproval?.origin === evidence.browse.origin &&
      renewedApproval?.debuggerAttachedBeforeApproval === false,
    followUpUsesRealIpcWithoutMock:
      invoke.mockFallbackHitCount === 0 &&
      invoke.invokeErrorCount === 0 &&
      new Set(
        turnStarts
          .filter(
            (call) =>
              call.threadId === identity.threadId &&
              call.transport === "electron-ipc" &&
              call.status === "success",
          )
          .map((call) => call.requestId),
      ).size === 3,
    noFollowUpConsoleOrPageErrors:
      consoleErrors.length === 0 && pageErrors.length === 0,
  };
  const assertions = { ...evidence.assertions, ...checks };
  const failedAssertions = Object.entries(assertions)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  return sanitizeJson({
    ...evidence,
    status: failedAssertions.length ? "fail" : "pass",
    claimBoundary: `${evidence.claimBoundary} 后继验证同一thread三回合、重新claim和原生sendInputEvent撤权；不是OS物理输入、跨连接或重启后凭据恢复证明。`,
    threadReceipt: { turns, nativeInput, renewedApproval, turnStarts },
    invoke,
    assertions,
    failedAssertions,
  });
}
