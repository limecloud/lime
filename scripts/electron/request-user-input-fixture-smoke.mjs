#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  appServerCallFromPage,
  createTempRuntimeEnv,
  launchElectronFixture,
} from "./mcp-config-fixture-smoke.mjs";
import { captureMainProcessExit } from "./lib/persisted-atom-fixture-driver.mjs";
import {
  ASYNC_QUESTIONS,
  ASYNC_DONE,
  ASYNC_REPLY_DONE,
  runAsyncUserInputScenario,
} from "./lib/async-user-input-scenario.mjs";
import {
  fingerprintArtifacts,
  fingerprintSources,
  sha256,
} from "./lib/sidebar-layout-fixture-evidence.mjs";
import { settleFixtureResources } from "../lib/chat-fixture/teardown.mjs";
import { inspectElectronFixtureBuildFreshness } from "../lib/electron-fixture-build.mjs";
import {
  electronAppServerBinaryDestination,
  resolveElectronAppServerRuntimeEnv,
} from "../lib/electron-app-server-assets.mjs";
import { startOpenAiCompatibleFixtureServer } from "../lib/openai-compatible-fixture-server.mjs";
import {
  buildToolExecutionTurnStartParams,
  createToolExecutionThreadCurrent,
  provisionToolExecutionFixtureProvider,
} from "../agent-runtime/tool-execution-current-contract.mjs";
import {
  captureInvokeTraceCollector,
  installInvokeTraceCollector,
  stopInvokeTraceCollector,
  validateInvokeTraceCollectorCapture,
} from "../lib/invoke-trace-collector.mjs";
import {
  composerEditorSelector,
  fillComposerEditor,
  readComposerEditorText,
} from "../lib/composer-editor-dom.mjs";

const OPTIONS = { timeoutMs: 120_000, intervalMs: 100 };
const DONE = "REQUEST_USER_INPUT_CANONICAL_DONE";
const DRAFT = "主输入框未发送的草稿，问答与取消都必须保留。";
const CHOICE = "保留 A, B";
const FREEFORM = "自由答案，保留逗号, 和换行\n第二行";
const LIFECYCLE_KEY = "lime:debug:app-server-server-request-lifecycle:v1";
const SOURCE_FILES = [
  "scripts/electron/request-user-input-fixture-smoke.mjs",
  "scripts/electron/lib/async-user-input-scenario.mjs",
  "scripts/lib/electron-fixture-build.mjs",
  "scripts/lib/electron-app-server-assets.mjs",
  "src/components/agent/chat/workspace/useAsyncUserInput.tsx",
  "src/components/agent/chat/workspace/useWorkspaceInputbarSceneRuntime.tsx",
  "src/components/agent/chat/components/asyncUserInput/AsyncUserInputPanel.tsx",
  "src/components/agent/chat/components/asyncUserInput/QuestionDraftStore.ts",
  "src/components/agent/chat/components/asyncUserInput/questions.ts",
  "src/lib/api/agentRuntime/appServerCanonicalItemReader.ts",
  "src/lib/api/agentRuntime/appServerEventStreamRouting.ts",
  "src/lib/api/agentRuntime/threadClient.ts",
  "src/lib/api/appServerEventBus.ts",
  "src/components/agent/chat/hooks/useAgentStream.ts",
  "src/components/agent/chat/hooks/agentStreamResumeBinding.ts",
  "src/components/agent/chat/hooks/streamBindingRecords.ts",
  "src/components/agent/chat/hooks/agentSessionState.ts",
  "src/components/agent/chat/projection/threadReadActivity.ts",
  "src/components/agent/chat/hooks/useAgentChat.ts",
  "src/components/agent/chat/hooks/useAgentRuntimeSyncEffects.ts",
  "src/components/agent/chat/hooks/useAgentThreadReadSync.ts",
  "src/lib/api/agentRuntime/appServerNotificationDrift.ts",
  "scripts/agent-runtime/tool-execution-current-contract.mjs",
  "scripts/lib/openai-compatible-fixture-server.mjs",
  "scripts/lib/invoke-trace-collector.mjs",
  "src/components/agent/chat/components/RequestUserInputPanel.tsx",
  "src/components/agent/chat/components/StreamingProcessRun.tsx",
  "src/components/agent/chat/components/AgentThreadTimelineItemRenderers.tsx",
  "src/components/agent/chat/components/ActionRequestA2UIPreviewCard.tsx",
  "src/components/agent/chat/components/StreamingRenderer.tsx",
  "src/components/agent/chat/components/MessageList.types.ts",
  "src/components/agent/chat/components/MessageList.tsx",
  "src/components/agent/chat/components/MessageListItem.tsx",
  "src/components/agent/chat/components/MessageAssistantBody.tsx",
  "src/components/agent/chat/components/messageListItemProjection.ts",
  "src/components/agent/chat/components/messageListItemProjectionHelpers.ts",
  "src/components/agent/chat/types.ts",
  "src/components/agent/chat/utils/actionRequestA2UI.ts",
  "src/components/agent/chat/workspace/useWorkspaceA2UIRuntime.ts",
  "src/components/agent/chat/workspace/useWorkspaceA2UISubmitActions.ts",
  "src/components/agent/chat/workspace/useWorkspacePendingInputRuntime.ts",
  "src/components/agent/chat/workspace/useWorkspaceConversationMessageListRuntime.ts",
  "src/components/agent/chat/workspace/useWorkspaceConversationSceneRuntime.tsx",
  "src/components/agent/chat/workspace/useAgentChatWorkspaceSceneRuntime.tsx",
  "src/components/agent/chat/workspace/useAgentChatWorkspaceSetupRuntime.ts",
  "src/components/agent/chat/components/QuestionAnswerEditor.tsx",
  "src/components/agent/chat/components/requestUserInputDraft.ts",
  "src/components/agent/chat/components/RequestUserInputDraftStore.ts",
  "src/components/agent/chat/components/DecisionPanel.tsx",
  "src/components/agent/chat/components/PendingInteractionLayer/PendingInteractionLayer.tsx",
  "src/components/agent/chat/hooks/usePendingInteractions.ts",
  "src/lib/api/agentRuntime/pendingInteractionController.ts",
  "src/lib/api/appServerServerRequest.ts",
  "electron/appServerHost.ts",
  "electron/preload.ts",
];

/** Only successful current IPC entries may prove a request or response. */
export function decodeUserInputWire(entries) {
  return entries.flatMap((entry) => {
    if (
      entry.command !== "app_server_handle_json_lines" ||
      entry.transport !== "electron-ipc" ||
      entry.status !== "success"
    )
      return [];
    return (entry.args_preview?.request?.lines ?? []).map((line) =>
      JSON.parse(line),
    );
  });
}

function toolCall(id, questions) {
  return {
    type: "tool_call",
    id,
    name: "request_user_input",
    arguments: { questions },
  };
}

async function waitForTurn(call, threadId, turnId, status) {
  const deadline = Date.now() + OPTIONS.timeoutMs;
  while (Date.now() < deadline) {
    const read = await call("thread/read", { threadId, includeTurns: true });
    const turn = read.thread?.turns?.find((item) => item.id === turnId);
    if (turn?.status === status) return turn;
    if (["completed", "failed", "interrupted"].includes(turn?.status))
      throw new Error(`unexpected canonical terminal ${turn.status}`);
    await new Promise((resolve) => setTimeout(resolve, OPTIONS.intervalMs));
  }
  throw new Error(`canonical turn did not become ${status}`);
}

export async function runRequestUserInputFixture(argv = process.argv.slice(2)) {
  assert.equal(argv.length, 2, "requires --run-id <fresh-id>");
  assert.equal(argv[0], "--run-id");
  const runId = argv[1];
  assert.match(runId, /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
  const rootDir = process.cwd();
  const evidenceDir = path.resolve(
    ".lime/qc/gui-evidence/request-user-input",
    runId,
  );
  assert.equal(fs.existsSync(evidenceDir), false, "fresh evidence required");
  fs.mkdirSync(evidenceDir, { recursive: true });
  const runtimeEnv = createTempRuntimeEnv();
  const summary = {
    runId,
    ok: false,
    result: "fail",
    proofLevel: "Desktop Gate B controlled runtime/provider fixture",
    backendMode: "runtime",
    live: false,
    claimBoundary:
      "Isolated source-build macOS Electron, current preload/IPC, App Server/runtime and localhost provider; synchronous and async questions, canonical replies and same-renderer draft restoration across threads. Async model capability uses explicit test-only policy; production catalog discovery, reference execution, live provider, Windows, packaged release and app-restart draft restoration are not claimed.",
    startedAt: new Date().toISOString(),
    ipcReceipts: [],
    screenshots: [],
  };
  const consoleErrors = [];
  const pageErrors = [];
  const rendererMessages = [];
  const rendererMessageReads = [];
  let handle, mainExit, fixture, collector, collectorPage, failure;
  const asyncQuestion = Promise.withResolvers();
  const asyncContinuation = Promise.withResolvers();
  const stage = (value) => {
    summary.stage = value;
    console.log(`[request-user-input-fixture] stage=${value}`);
  };
  const requireFresh = () => {
    const freshness = inspectElectronFixtureBuildFreshness({ rootDir });
    assert.ok(freshness.ready, `stale build: ${freshness.staleSegments}`);
    return { ready: true, reason: freshness.reason };
  };
  const captureDiagnostics = async (name) => {
    await Promise.allSettled(rendererMessageReads);
    const snapshot = {
      stage: summary.stage,
      host: await handle?.page
        .evaluate(() => window.electronAPI.invoke("app_server_host_diagnostics"))
        .catch((error) => ({ error: error.message })),
      rendererMessages,
      providerRequests: (fixture?.requests ?? []).map((request) => ({
        path: request.path,
        model: request.body?.model,
        tools: (request.body?.tools ?? []).map(
          (tool) => tool.function?.name ?? tool.name,
        ),
      })),
      lifecycle: await handle?.page
        .evaluate(
          (key) => JSON.parse(localStorage.getItem(key) || "[]"),
          LIFECYCLE_KEY,
        )
        .catch((error) => ({ error: error.message })),
      thread: summary.identity
        ? await appServerCallFromPage(handle.page, "thread/read", {
            threadId: summary.identity.threadId,
            includeTurns: true,
          }).catch((error) => ({ error: error.message }))
        : null,
      dom: await handle?.page
        .evaluate(() => ({
          text: document.body.innerText.slice(-12000),
          editors: Array.from(
            document.querySelectorAll('[data-testid="composer-editor"]'),
          ).map((node) => ({
            sessionId: node.getAttribute("data-session-id"),
            text: node.textContent,
            visible: node.getClientRects().length > 0,
          })),
        }))
        .catch((error) => ({ error: error.message })),
      invokeTrace: collector
        ? await captureInvokeTraceCollector(collectorPage, collector).catch(
            (error) => ({ error: error.message }),
          )
        : null,
    };
    fs.writeFileSync(
      path.join(evidenceDir, `diagnostics-${name}.json`),
      `${JSON.stringify(snapshot, null, 2)}\n`,
    );
  };
  try {
    stage("verify-current-artifacts");
    summary.buildBefore = requireFresh();
    summary.sourceSha256 = fingerprintSources(rootDir, SOURCE_FILES);
    summary.artifactsBefore = fingerprintArtifacts(rootDir);
    fixture = await startOpenAiCompatibleFixtureServer({
      deferScriptedToolCallsUntilAvailable: true,
      scriptedResponses: [
        async () => {
          await asyncQuestion.promise;
          return {
            type: "tool_call",
            id: "call-async-question",
            name: "request_user_input_async",
            arguments: { questions: ASYNC_QUESTIONS },
          };
        },
        async () => {
          await asyncContinuation.promise;
          return { type: "text", content: ASYNC_DONE };
        },
        { type: "text", content: ASYNC_REPLY_DONE },
        toolCall("call-question-answer", [
          {
            id: "choice_id",
            header: "选择",
            question: "选择如何保留文本？",
            options: [
              { label: CHOICE, description: "完整选项，不拆分标点" },
              { label: "其他方式", description: "本轮不选" },
            ],
          },
          { id: "freeform_id", header: "说明", question: "填写具体说明？" },
        ]),
        { type: "text", content: DONE },
        toolCall("call-question-cancel", [
          {
            id: "cancel_id",
            header: "中断",
            question: "此题通过 Escape 中断。",
          },
        ]),
        { type: "text", content: "UNEXPECTED_AFTER_CANCEL" },
      ],
    });
    const binary = electronAppServerBinaryDestination({
      outputRoot: path.join(rootDir, "dist-electron"),
    });
    summary.appServerExecutableRelativePath = path
      .relative(rootDir, binary)
      .split(path.sep)
      .join("/");
    summary.appServerExecutableSha256 = sha256(fs.readFileSync(binary));
    assert.equal(
      summary.artifactsBefore["dist-electron"].files.find(
        (file) => file.file === summary.appServerExecutableRelativePath,
      )?.sha256,
      summary.appServerExecutableSha256,
      "executed App Server must be included in the artifact fingerprint",
    );
    const appServerEnv = resolveElectronAppServerRuntimeEnv({
      env: { ...runtimeEnv.env, APP_SERVER_BIN: binary },
    });
    stage("launch-isolated-runtime-electron");
    handle = await launchElectronFixture({
      options: OPTIONS,
      runtimeEnv,
      appServerEnv,
      consoleErrors,
      pageErrors,
      backendMode: "runtime",
    });
    mainExit = captureMainProcessExit(handle.app.process());
    summary.mainShutdownOutput = [];
    for (const stream of [handle.app.process().stdout, handle.app.process().stderr])
      stream?.on("data", (chunk) => {
        const output = String(chunk);
        if (/fixture-quit|Debugger|debugger|App Server shutdown|app-server.*(stop|exit)/u.test(output))
          summary.mainShutdownOutput.push(output.slice(0, 16000));
        summary.mainShutdownOutput = summary.mainShutdownOutput.slice(-40);
      });
    await handle.app.evaluate(({ app }) => {
      for (const eventName of ["before-quit", "will-quit", "quit"])
        app.on(eventName, (event) => process.stdout.write("[fixture-quit]" +
          JSON.stringify({ event: eventName, at: new Date().toISOString(),
            prevented: event?.defaultPrevented ?? null,
            resources: process.getActiveResourcesInfo() }) + "\n"));
    });
    await handle.app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.setBackgroundThrottling(false);
        window.showInactive();
      }
    });
    const page = handle.page;
    page.on("console", (message) => {
      if (
        !["warning", "error"].includes(message.type()) &&
        !message.text().startsWith("[AgentDebug]")
      )
        return;
      const entry = { type: message.type(), text: message.text() };
      rendererMessages.push(entry);
      rendererMessageReads.push(
        Promise.allSettled(
          message.args().map((argument) => argument.jsonValue()),
        ).then((results) => {
          entry.details = results.map((result) =>
            result.status === "fulfilled"
              ? result.value
              : { unavailable: String(result.reason) },
          );
        }),
      );
      if (message.type() === "error") consoleErrors.push(entry.text);
    });
    const call = async (method, params) => {
      const reply = await appServerCallFromPage(page, method, params);
      assert.equal(reply.ipcObservation.electron, true);
      assert.equal(reply.ipcObservation.fallback, false);
      summary.ipcReceipts.push(reply.ipcObservation);
      return reply.result;
    };
    const invoke = (_options, method, params) => call(method, params);
    const provider = await provisionToolExecutionFixtureProvider({
      fixture,
      invoke,
      options: OPTIONS,
    });
    const workspaceRoot = path.join(runtimeEnv.tempRoot, "question-workspace");
    fs.mkdirSync(workspaceRoot);
    const identity = await createToolExecutionThreadCurrent({
      invoke,
      options: OPTIONS,
      provider,
      workspaceRoot,
      title: "Request user input canonical fixture",
    });
    summary.identity = identity;
    const otherIdentity = await createToolExecutionThreadCurrent({
      invoke,
      options: OPTIONS,
      provider,
      workspaceRoot,
      title: "Request user input other thread",
    });
    summary.otherIdentity = otherIdentity;
    await call("thread/settings/update", {
      threadId: identity.threadId,
      modelProvider: provider.providerPreference,
      model: provider.modelPreference,
    });
    await page.evaluate((sessionId) => {
      localStorage.setItem("lime:agent-debug", "1");
      localStorage.setItem("lime:debug:claw-trace-enabled:v1", "true");
      sessionStorage.setItem(
        "lime.appNavigation.restore.v1",
        JSON.stringify({
          page: "agent",
          params: { initialSessionId: sessionId },
        }),
      );
    }, identity.sessionId);
    await page.reload({ waitUntil: "domcontentloaded" });
    const mainEditor = page.locator(
      `${composerEditorSelector(identity.sessionId)}:visible`,
    );
    await mainEditor.waitFor({ state: "visible" });
    await page.waitForFunction(
      (selector) =>
        Array.from(document.querySelectorAll(selector)).some(
          (node) =>
            node instanceof HTMLElement &&
            node.getClientRects().length > 0 &&
            node.getAttribute("aria-disabled") === "false",
        ),
      composerEditorSelector(identity.sessionId),
    );
    await fillComposerEditor(page, DRAFT, identity.sessionId);
    let mainEditorHandle = await mainEditor.elementHandle();
    collectorPage = page;
    collector = await installInvokeTraceCollector(page);
    const startTurn = async (message, clientUserMessageId, metadata) => {
      const result = await call(
        "turn/start",
        buildToolExecutionTurnStartParams({
          threadId: identity.threadId,
          workspaceRoot,
          message,
          clientUserMessageId,
          model: provider.modelPreference,
          metadata,
        }),
      );
      assert.ok(result.turn?.id, "canonical Turn ID required");
      return result.turn.id;
    };
    const verifyMainDraft = async () => {
      assert.equal(
        await mainEditorHandle.evaluate((node) => node.isConnected),
        true,
      );
      assert.equal(await readComposerEditorText(mainEditor), DRAFT);
    };
    stage("async-question-producer-and-ordinary-reply");
    summary.asyncQuestions = await runAsyncUserInputScenario({
      page,
      identity,
      otherIdentity,
      call,
      startTurn,
      waitForTurn,
      verifyMainDraft,
      refreshMainEditor: async () => {
        mainEditorHandle = await mainEditor.elementHandle();
      },
      releaseContinuation: () => asyncContinuation.resolve(),
      releaseQuestion: () => asyncQuestion.resolve(),
      fixture,
      evidenceDir,
      summary,
      stage,
    });
    // Thread navigation remounts the editor; the async scenario verified its draft.
    mainEditorHandle = await mainEditor.elementHandle();
    stage("answer-provider-questions-through-gui");
    const answeredTurnId = await startTurn(
      "请用 request_user_input 提问两题，得到完整答案后完成。",
      "question-answer-user",
    );
    summary.answeredTurnId = answeredTurnId;
    await captureDiagnostics("turn-started");
    const panel = page.getByTestId("request-user-input-panel");
    await panel.locator('[role="radio"]').first().waitFor({ state: "visible" });
    assert.equal(await panel.getAttribute("data-question-id"), "choice_id");
    const answeredItemId = await panel.getAttribute("data-request-id");
    const requestLifecycle = async () =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key) || "[]"),
        LIFECYCLE_KEY,
      );
    const answeredRequest = (await requestLifecycle()).find(
      (entry) =>
        entry.kind === "request" &&
        entry.method === "item/tool/requestUserInput" &&
        entry.threadId === identity.threadId &&
        entry.turnId === answeredTurnId &&
        entry.itemId === answeredItemId,
    );
    assert.ok(
      answeredRequest,
      "same thread/turn/item reverse request required",
    );
    await verifyMainDraft();
    await panel.getByRole("radio", { name: new RegExp(CHOICE) }).click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="request-user-input-panel"]')
          ?.getAttribute("data-question-id") === "freeform_id",
    );
    const answerEditor = panel.locator(
      '[data-testid="composer-editor"][role="textbox"]',
    );
    await answerEditor.fill(FREEFORM);
    await verifyMainDraft();
    stage("restore-question-draft-after-thread-navigation");
    await page
      .locator(
        `[data-testid="app-sidebar-conversation-open"][data-session-id="${otherIdentity.sessionId}"]`,
      )
      .click();
    await page
      .locator(`${composerEditorSelector(otherIdentity.sessionId)}:visible`)
      .waitFor({ state: "visible" });
    await panel.waitFor({ state: "hidden" });
    assert.equal(
      await mainEditor.count(),
      0,
      "the original thread Composer must not remain the visible input on another thread",
    );
    await page
      .locator(
        `[data-testid="app-sidebar-conversation-open"][data-session-id="${identity.sessionId}"]`,
      )
      .click();
    await mainEditor.waitFor({ state: "visible" });
    await page.waitForFunction(
      (selector) =>
        Array.from(document.querySelectorAll(selector)).some(
          (node) =>
            node instanceof HTMLElement &&
            node.getClientRects().length > 0 &&
            node.getAttribute("aria-disabled") === "false",
        ),
      composerEditorSelector(identity.sessionId),
    );
    await panel.waitFor({ state: "visible" });
    assert.equal(await panel.getAttribute("data-request-id"), answeredItemId);
    assert.equal(await panel.getAttribute("data-question-id"), "freeform_id");
    assert.equal(await readComposerEditorText(answerEditor), FREEFORM);
    mainEditorHandle = await mainEditor.elementHandle();
    await verifyMainDraft();
    await page.screenshot({
      path: path.join(evidenceDir, "freeform-question.png"),
    });
    summary.screenshots.push("freeform-question.png");
    await panel.getByRole("button", { name: "提交", exact: true }).click();
    const completed = await waitForTurn(
      call,
      identity.threadId,
      answeredTurnId,
      "completed",
    );
    assert.ok(JSON.stringify(completed).includes(DONE));
    await page.getByText(DONE, { exact: true }).waitFor({ state: "visible" });
    await page
      .getByRole("button", { name: "停止", exact: true })
      .waitFor({ state: "hidden" });
    await panel.waitFor({ state: "hidden" });
    await verifyMainDraft();
    let capture = await captureInvokeTraceCollector(page, collector);
    let verified = validateInvokeTraceCollectorCapture(capture, collector);
    assert.equal(verified.complete, true);
    const resultMessages = decodeUserInputWire(verified.ledgerEntries).filter(
      (message) => Object.hasOwn(message, "result"),
    );
    assert.equal(
      resultMessages.length,
      1,
      "exactly one reverse request response",
    );
    assert.equal(
      resultMessages[0].id,
      answeredRequest.id,
      "original Host request token required",
    );
    assert.deepEqual(resultMessages[0].result, {
      answers: {
        choice_id: { answers: [CHOICE] },
        freeform_id: { answers: [FREEFORM] },
      },
    });
    const providerFollowup = fixture.requests.find(
      (request) =>
        request.responseKind === "text" &&
        JSON.stringify(request.body).includes(CHOICE) &&
        FREEFORM.split("\n").every((line) =>
          JSON.stringify(request.body).includes(line),
        ),
    );
    assert.ok(
      providerFollowup,
      "runtime must deliver the GUI answers back to provider",
    );
    summary.answered = {
      turnId: answeredTurnId,
      itemId: answeredItemId,
      canonicalStatus: completed.status,
      finalAnswerVisible: true,
      stopHidden: true,
      exactCanonicalAnswers: true,
      responseIdSha256: sha256(JSON.stringify(resultMessages[0].id)),
      providerReceivedAnswers: true,
      mainDraftPreserved: true,
      sameMainEditorWithinMount: true,
      questionAndFreeformRestoredAcrossThreads: true,
      mainDraftRestoredAcrossThreads: true,
    };
    stage("escape-interrupts-the-scoped-turn");
    const cancelledTurnId = await startTurn(
      "请用 request_user_input 提问并等待，此回合用于真实取消。",
      "question-cancel-user",
    );
    await panel.waitFor({ state: "visible" });
    assert.equal(await panel.getAttribute("data-question-id"), "cancel_id");
    const cancelledItemId = await panel.getAttribute("data-request-id");
    const cancelledRequest = (await requestLifecycle()).find(
      (entry) =>
        entry.kind === "request" &&
        entry.method === "item/tool/requestUserInput" &&
        entry.threadId === identity.threadId &&
        entry.turnId === cancelledTurnId &&
        entry.itemId === cancelledItemId,
    );
    assert.ok(
      cancelledRequest,
      "cancel must target the visible canonical request",
    );
    await panel
      .locator('[data-testid="composer-editor"][role="textbox"]')
      .fill("此草稿不会作为答案提交");
    const threadStatusWarningCount = await page
      .locator("[data-sonner-toast]")
      .filter({ hasText: "thread/status/changed" })
      .count();
    assert.equal(
      threadStatusWarningCount,
      0,
      "canonical thread status must refresh the read model without an unprojected warning",
    );
    await page.screenshot({
      path: path.join(evidenceDir, "before-question-cancel.png"),
    });
    summary.screenshots.push("before-question-cancel.png");
    await panel.press("Escape");
    const interrupted = await waitForTurn(
      call,
      identity.threadId,
      cancelledTurnId,
      "interrupted",
    );
    await panel.waitFor({ state: "hidden" });
    await verifyMainDraft();
    capture = await captureInvokeTraceCollector(page, collector);
    verified = validateInvokeTraceCollectorCapture(capture, collector);
    assert.equal(verified.complete, true);
    const wire = decodeUserInputWire(verified.ledgerEntries);
    const asyncReplies = wire.filter(
      (message) =>
        message.method === "turn/start" &&
        message.params?.threadId === identity.threadId &&
        JSON.stringify(message.params.input).includes(
          "send_user_message_question_reply",
        ),
    );
    assert.equal(
      asyncReplies.length,
      1,
      "async reply uses ordinary scoped turn/start",
    );
    assert.equal(
      Object.hasOwn(asyncReplies[0].params, "approvalPolicy"),
      false,
    );
    assert.equal(Object.hasOwn(asyncReplies[0].params, "sandboxPolicy"), false);
    summary.asyncQuestions.replyWire = {
      method: "turn/start",
      count: 1,
      permissionOverrides: false,
    };
    assert.equal(
      wire.filter((message) => Object.hasOwn(message, "result")).length,
      1,
      "Escape must not send empty answers",
    );
    assert.equal(
      wire.some((message) => message.id === cancelledRequest.id),
      false,
      "cancelled request must not receive a forged response",
    );
    assert.equal(
      wire.filter(
        (message) =>
          message.method === "turn/interrupt" &&
          message.params?.threadId === identity.threadId &&
          message.params?.turnId === cancelledTurnId,
      ).length,
      1,
      "exact scoped GUI interrupt required",
    );
    assert.ok(!JSON.stringify(interrupted).includes("UNEXPECTED_AFTER_CANCEL"));
    summary.cancelled = {
      turnId: cancelledTurnId,
      itemId: cancelledItemId,
      canonicalStatus: interrupted.status,
      exactScopedInterrupt: true,
      emptyAnswersSent: false,
      mainDraftPreserved: true,
      sameMainEditor: true,
    };
    summary.trace = { complete: true, provenance: verified.provenance };
    summary.errors = {
      threadStatusWarningCount,
      invokeErrorCount: await page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem("lime_invoke_error_buffer_v1") || "[]",
          ).length,
      ),
      failedTraceCount: verified.ledgerEntries.filter(
        (entry) => entry.status === "error",
      ).length,
      mockFallbackHitCount: verified.ledgerEntries.filter(
        (entry) => entry.transport !== "electron-ipc",
      ).length,
      consoleErrorCount: consoleErrors.length,
      pageErrorCount: pageErrors.length,
    };
    for (const count of Object.values(summary.errors)) assert.equal(count, 0);
    summary.buildAfter = requireFresh();
    assert.deepEqual(
      fingerprintSources(rootDir, SOURCE_FILES),
      summary.sourceSha256,
    );
    assert.deepEqual(fingerprintArtifacts(rootDir), summary.artifactsBefore);
    summary.sourceAndArtifactIdentityStable = true;
  } catch (error) {
    failure = error;
    summary.failure = {
      stage: summary.stage,
      name: error.name,
      message: error.message,
    };
    console.error(`[request-user-input-fixture] failed: ${error.message}`);
    await captureDiagnostics("failure");
    if (handle?.page)
      await handle.page
        .screenshot({
          path: path.join(evidenceDir, "failure.png"),
          timeout: 5_000,
        })
        .catch(() => undefined);
  } finally {
    asyncQuestion.resolve();
    asyncContinuation.resolve();
    summary.teardown = await settleFixtureResources({
      app: handle?.app,
      mainExit,
      textProviderFixtureServer: fixture,
      invokeTraceCollector: collector
        ? {
            stop: () => stopInvokeTraceCollector(collectorPage, collector),
          }
        : undefined,
      timeoutMs: 15_000,
      cleanupTemp: () =>
        fs.rmSync(runtimeEnv.tempRoot, { recursive: true, force: true }),
    });
    summary.consoleErrors = consoleErrors;
    summary.pageErrors = pageErrors;
    summary.ok =
      !failure &&
      summary.teardown.ok &&
      summary.teardown.normalMainExit?.exitCode === 0 &&
      summary.teardown.normalMainExit?.signal === null;
    summary.result = summary.ok ? "pass" : "fail";
    summary.completedAt = new Date().toISOString();
    fs.writeFileSync(
      path.join(evidenceDir, "summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
    console.log(
      `[request-user-input-fixture] evidence=${evidenceDir} result=${summary.result}`,
    );
  }
  if (!summary.ok) throw failure ?? new Error("normal Main shutdown failed");
  return summary;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href)
  runRequestUserInputFixture().catch(() => {
    process.exitCode = 1;
  });
