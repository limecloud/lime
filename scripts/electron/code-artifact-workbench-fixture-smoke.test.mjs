import fs from "node:fs";
import { describe, expect, it } from "vitest";

function readSmokeScript() {
  return fs.readFileSync(
    "scripts/electron/code-artifact-workbench-fixture-smoke.mjs",
    "utf8",
  );
}

describe("code artifact workbench Electron fixture smoke guard", () => {
  it("rejects missing identity, expanded payload and leaked tool output", () => {
    const content = readSmokeScript();
    const helper = content.slice(
      content.indexOf("function hasCollapsedHistoricalToolResults("),
      content.indexOf("function hasHydratedSessionSnapshot("),
    );
    const check = new Function(
      `${helper}; return hasCollapsedHistoricalToolResults;`,
    )();
    const collapsed = {
      toolCallRowCount: 2,
      fixtureToolRowCount: 1,
      fixtureToolRowCanonical: true,
      fixtureToolRowCollapsed: true,
      fixtureToolOutputHidden: true,
      operationalTimelineDetailsCount: 0,
    };
    expect(check(collapsed)).toBe(true);
    expect(check(null)).toBe(false);
    for (const invalid of [
      { toolCallRowCount: 0 },
      { fixtureToolRowCount: 0 },
      { fixtureToolRowCount: 2 },
      { fixtureToolRowCanonical: false },
      { fixtureToolRowCollapsed: false },
      { fixtureToolOutputHidden: false },
      { operationalTimelineDetailsCount: 1 },
    ]) {
      expect(check({ ...collapsed, ...invalid })).toBe(false);
    }
    expect(content).toContain("toolResultExpandedAndRestored: true");
    expect(content).toContain("historicalToolResultDisclosureWorks:");
  });

  it("keeps the smoke on real Electron Desktop Host IPC and App Server JSON-RPC", () => {
    const content = readSmokeScript();

    expect(content).toContain("import { _electron as electron }");
    expect(content).toContain("electron.launch({");
    expect(content).toContain("waitForAppUrlReady");
    expect(content).toContain('logStage("wait-app-url")');
    expect(content).toContain('"--use-mock-keychain"');
    expect(content).toContain("ELECTRON_E2E_USER_DATA_DIR");
    expect(content).toContain('LIME_ELECTRON_E2E: "1"');
    expect(content).toContain('LIME_ELECTRON_DEV_HTTP_BRIDGE: "0"');
    expect(content).toContain("window.__LIME_ELECTRON__ === true");
    expect(content).toContain(
      'typeof window.electronAPI?.invoke === "function"',
    );
    expect(content).toContain("window.electronAPI.supportsCommand");
    expect(content).toContain("app_server_handle_json_lines");
  });

  it("uses a local external fixture backend instead of a live provider or mock backend", () => {
    const content = readSmokeScript();

    expect(content).toContain('APP_SERVER_BACKEND_MODE: "external"');
    expect(content).toContain("APP_SERVER_BACKEND_COMMAND: process.execPath");
    expect(content).toContain("writeFixtureBackend");
    expect(content).toContain('modelProvider: "fixture-provider"');
    expect(content).toContain('model: "fixture-model"');
    expect(content).toContain(
      "requestMetadata = readApplicationMetadata(request.metadata)",
    );
    expect(content).toContain("inputText = readRuntimeInputText(request)");
    expect(content).toContain("function readRuntimeInputText(request)");
    expect(content).toContain("request?.input?.parts");
    expect(content).toContain("threadId = String(session.threadId");
    expect(content).toContain("liveProviderNotUsed");
    expect(content).toContain('entry.kind !== "turnStart"');
    expect(content).toContain("!entry.providerPreference");
    expect(content).toContain("!entry.modelPreference");
    expect(content).not.toContain('APP_SERVER_BACKEND_MODE: "mock"');
    expect(content).not.toContain('backendMode: "mock"');
    expect(content).not.toContain("--allow-live-provider");
    expect(content).not.toContain("APP_SERVER_BACKEND_COMMAND: undefined");
  });

  it("creates a canonical thread and uses current Changes, timeline and Composer", () => {
    const content = readSmokeScript();

    expect(content).toContain('"thread/start"');
    expect(content).toContain('"turn/start"');
    expect(content).toContain('"thread/read"');
    expect(content).toContain("thread/start 未返回 canonical sessionId");
    expect(content).toContain("thread/start 未返回 canonical thread.id");
    expect(content).toContain('input: [{ type: "text", text: USER_PROMPT }]');
    expect(content).not.toContain('"agentSession/update"');
    expect(content).toContain('type: "item.started"');
    expect(content).toContain('type: "item.completed"');
    expect(content).toContain('type: "message.delta"');
    expect(content).toContain('type: "message.completed"');
    expect(content).not.toContain("canonicalAssistantItem");
    expect(content).toContain("itemId: assistantItemId");
    expect(content).toContain('phase: "final_answer"');
    expect(content).not.toContain('kind: "agentMessage"');
    expect(content).not.toContain('type: "agentMessage"');
    expect(content).toContain("canonicalToolItem");
    expect(content).toContain("call_id: toolCallId");
    expect(content).toContain("changes: [");
    expect(content).toContain('kind: { type: "update" }');
    expect(content).toContain(
      'status: status === "completed" ? "applied" : "proposed"',
    );
    expect(content).not.toContain('callId: "${TOOL_CALL_ID}"');
    expect(content).toContain("ordinal: 4");
    expect(content).not.toContain('type: "tool.started"');
    expect(content).not.toContain('type: "tool.result"');
    expect(content).toContain("TOOL_CALL_ID");
    expect(content).toContain("TOOL_OUTPUT_PREVIEW");
    expect(content).toContain("collectToolCalls");
    expect(content).toContain("hasToolTimelineProjection");
    expect(content).toContain("toolTimelineProjectionPersisted");
    expect(content).toContain("codingProjectionPersisted");
    expect(content).toContain("inspectHistoricalTimelineSummary");
    expect(content).toContain(
      'logStage("inspect-historical-timeline-summary")',
    );
    expect(content).toContain("timelineProcessEvidence");
    expect(content).toContain("hasCollapsedHistoricalToolResults");
    expect(content).toContain(
      '[data-testid^="message-list-historical-timeline-preview:"]',
    );
    expect(content).toContain('[data-testid="tool-call-row"]');
    expect(content).toContain("collectThreadCommandEvidence");
    expect(content).toContain("commandOutputVisible");
    expect(content).toContain("command.aggregatedOutput");
    expect(content).toContain("data-tool-call-id");
    expect(content).toContain("tool-call-result-panel");
    expect(content).toContain("openThreadChanges");
    expect(content).toContain("selectThreadSidePanelTool");
    expect(content).toContain("workspace-changes-surface");
    expect(content).toContain("data-review-thread-id");
    expect(content).toContain("gui-coding-input");
    expect(content).toContain("GUI_CODING_PROMPT");
    expect(content).toContain("sendPromptFromGui");
    expect(content).toContain("guiPromptSubmitted");
    expect(content).toContain("guiSessionOpenAfterInputClick");
    expect(content).toContain('logStage("wait-gui-coding-turn-terminal")');
    const guiCodingTerminalFlow = content.slice(
      content.indexOf('logStage("wait-gui-coding-read-model")'),
      content.indexOf('logStage("open-session-after-gui-coding-input")'),
    );
    expect(guiCodingTerminalFlow).toContain("waitForCodeArtifactTurnTerminal");
    expect(content).toContain("CODING_FOLLOWUP_PROMPT");
    expect(content).toContain("waitForCodingFollowupGuiTerminal");
    expect(content).toContain("findCodingFollowupTurnStart");
    expect(content).toContain("followupCommandEvidence");
    const followupFlow = content.slice(
      content.indexOf('logStage("submit-coding-followup-from-composer")'),
      content.indexOf('logStage("review-files-from-right-surface")'),
    );
    expect(followupFlow).toContain("sendPromptFromGui(");
    expect(followupFlow).not.toContain("openFixtureSessionFromSidebar");
    expect(content).toContain("readTurnStartInputText");
    expect(content).not.toContain("runtimeOptions");
    expect(content).not.toContain("runtimeRequest");
    const codingProjectionHelpers = content.slice(
      content.indexOf("function hasCodingProjection(readResult)"),
      content.indexOf("async function ensureDefaultWorkspace"),
    );
    expect(codingProjectionHelpers).not.toContain(
      "JSON.stringify(readResult || {})",
    );
    expect(content).toContain('item?.type === "fileChange"');
    expect(content).toContain('item?.type === "commandExecution"');
    expect(content).toContain('item.status === "completed"');
    expect(content).toContain("item.exitCode === 0");
    expect(content).toContain("codingFollowupGuiSubmitted");
    expect(content).toContain("codingFollowupReachedBackend");
    expect(content).toContain("codingFollowupTraceWire");
    expect(content).toContain("codingFollowupReadCompleted");
    expect(content).not.toContain("capturedRecoveryContext");
    expect(content).toContain("appServerJsonRpcObserved");
    expect(content).toContain("backendTurnStartObserved");
    expect(content).toContain("canonicalSessionIdentity:");
    expect(content).toContain("codingFollowupCanonicalIdentity:");
    expect(content).toContain("codingFollowupTraceThreadIdentity:");
    expect(content).toContain("assertNoRendererErrors");
    expect(content).toContain("Electron renderer console error");
    expect(content).toContain("Electron renderer page error");
    expect(content).toContain(
      "assertNoRendererErrors(consoleErrors, pageErrors)",
    );
    expect(content).toContain("lime:agent-runtime-sessions-changed");
    expect(content).toContain('reason: "external"');
    expect(content).toContain("workspaceId");
    expect(content).toContain("threadChangesOpened");
    expect(content).toContain("commandOutputVisible");
    expect(content).toContain("canonicalFileItem");
    expect(content).toContain("canonicalCommandItem");
    expect(content).not.toContain('type: "file.changed"');
    expect(content).not.toContain('type: "patch.started"');
    expect(content).not.toContain('type: "patch.applied"');
    expect(content).not.toContain('type: "command.started"');
    expect(content).not.toContain('type: "command.output"');
    expect(content).not.toContain('type: "command.exited"');
    expect(content).not.toContain('type: "test.started"');
    expect(content).not.toContain('type: "test.completed"');
    expect(content).toContain("historicalToolResultsCollapsed");
    const historicalDetailsAssertion = content.slice(
      content.indexOf("historicalToolResultsCollapsed,"),
      content.indexOf(
        "noInvokeErrors:",
        content.indexOf("historicalToolResultsCollapsed,"),
      ),
    );
    expect(historicalDetailsAssertion).not.toContain(
      "toolTimelineProjectionPersisted",
    );
    expect(content).toContain(
      "timelineProcessEvidence?.fixtureToolRowCanonical === true",
    );
    expect(content).toContain('type: "artifact.snapshot"');
    expect(content).toContain('type: "turn.completed"');
    expect(content).toContain(
      'const APP_SERVER_METHOD_ARTIFACT_WRITE = "artifact/write"',
    );
    expect(content).toContain("waitForCodeArtifactTurnTerminal");
    expect(content).toContain("writeArtifactFromCurrentRenderer");
    expect(content).toContain('"/src/lib/api/appServer.ts"');
    expect(content).toContain(".createAppServerClient()");
    expect(content).toContain(".writeArtifact(params)");
    expect(content).toContain("findArtifactWriteElectronIpcTrace");
    expect(content).toContain("waitForArtifactWriteElectronIpcTrace");
    expect(content).toContain(
      "entry?.command !== APP_SERVER_HANDLE_JSON_LINES_COMMAND",
    );
    expect(content).toContain('entry?.transport !== "electron-ipc"');
    expect(content).toContain(
      "message?.method !== APP_SERVER_METHOD_ARTIFACT_WRITE",
    );
    expect(content).toContain("typedArtifactWriteUsed:");
    expect(content).toContain("typedArtifactWriteElectronIpcTrace:");
    expect(content).toContain(
      "summary.sessionCreation?.artifactWriteIpcTrace?.threadId ===",
    );
    expect(content).toContain(
      "summary.sessionCreation?.artifactWriteIpcTrace?.turnId === TURN_ID",
    );
    expect(content).toContain(
      "summary.sessionCreation?.artifactWriteIpcTrace?.artifactRef ===",
    );
    expect(content).toContain("directSessionBackendDidNotInjectArtifact:");
    expect(content).toContain(
      'process.env.CODE_ARTIFACT_WORKBENCH_FIXTURE_SCENARIO !== "direct-session"',
    );
    expect(content.indexOf("waitForCodeArtifactTurnTerminal")).toBeLessThan(
      content.indexOf(
        "const artifactWrite = await writeArtifactFromCurrentRenderer(",
      ),
    );
    expect(content).not.toContain('type: "turn.final_done"');
    expect(content).toContain('kind: "backendEvents"');
    expect(content).toContain("backendEmittedEventTypes");
    expect(content).toContain("backendEmittedCurrentTerminal");
    expect(content).toContain("backendDidNotEmitLegacyTerminal");
    expect(content).toContain("canonicalItemLifecycleClean");
    expect(content).toContain(
      'items.filter((item) => item?.type === "agentMessage").length === 1',
    );
    expect(content).toContain("new Set(itemIds).size === itemIds.length");
    expect(content).toContain(
      'items.every((item) => item?.status !== "inProgress")',
    );
    expect(content).toContain("Hello Lime Workbench");
    expect(content).toContain("CODE_ARTIFACT_WORKBENCH_DONE");
    expect(content).toContain("waitForFixtureSessionOpenedFromSidebar");
    expect(content).not.toContain('"lime:task-center:open-task"');
    expect(content).toContain("openThreadChanges");
    expect(content).toContain("hasUserPrompt");
    expect(content).toContain("function hasHydratedSessionSnapshot(snapshot)");
    expect(content).not.toContain("hasGuiCodingInputHydratedSession");
    expect(content).toContain(
      "guiHydratedSession: hasHydratedSessionSnapshot(",
    );
    expect(content).not.toContain("hasToolTimelineText");
    expect(content).toContain("snapshot.sessionMatches === true");
    expect(content).toContain("代码产物会话未在 GUI 中完成 hydrate:");
    expect(content).not.toContain("const sourceText =");
    expect(content).toContain('window.dispatchEvent(new Event("focus"))');
  });

  it("keeps ordinary followup execution identities scoped to the new canonical turn", () => {
    const content = readSmokeScript();

    expect(content).toContain("const turnScopedExecutionId = (baseId) =>");
    expect(content).toContain(
      'isFollowupTurn || isReviewTurn ? baseId + ":" + turnId : baseId',
    );
    expect(content).toContain(
      'const assistantItemId = turnScopedExecutionId("code-artifact-workbench-electron:assistant")',
    );
    expect(content).toContain(
      'const toolCallId = turnScopedExecutionId("${TOOL_CALL_ID}")',
    );
    expect(content).toContain(
      'const fileChangeItemId = turnScopedExecutionId("${CODING_ARTIFACT_ID}")',
    );
    expect(content).toContain(
      'const commandId = turnScopedExecutionId("${CODING_COMMAND_ID}")',
    );
    expect(content).not.toContain("const patchId = turnScopedExecutionId");
    expect(content).not.toContain("const testRunId = turnScopedExecutionId");
    expect(content).toContain("assistantItemId,");
    expect(content).toContain("itemId: toolCallId");
    expect(content).toContain("call_id: toolCallId");
    expect(content).toContain("itemId: fileChangeItemId");
    expect(content).toContain("executionIds: {");
    expect(content).toContain("followupExecutionIdsTurnScoped:");
    expect(content).toContain("followupExecutionIds.length === 4");
    expect(content).toContain(
      "executionId.endsWith(`:${backendFollowupTurnStart.turnId}`)",
    );
    expect(content).not.toContain('itemId: "${TOOL_CALL_ID}"');
    expect(content).not.toContain('patchId: "${CODING_PATCH_ID}"');
    expect(content).not.toContain('commandId: "${CODING_COMMAND_ID}"');
    expect(content).not.toContain('testRunId: "${CODING_TEST_RUN_ID}"');
    expect(content).toContain("summary.followupCommandEvidence.turnId");
    expect(content).toContain("codingFollowupTraceThreadIdentity:");
  });

  it("keeps review-start on a dedicated message lifecycle without exposing its internal prompt", () => {
    const content = readSmokeScript();

    expect(content).toContain(
      'const isReviewTurn = inputText.startsWith("Review the current code changes")',
    );
    expect(content).toContain("const events = isReviewTurn ? [");
    expect(content).toContain(
      '"message.delta,message.completed,turn.completed"',
    );
    expect(content).toContain("reviewBackendUsesDedicatedMessageLifecycle");
    expect(content).toContain("reviewPromptHiddenFromTranscript");
    expect(content).toContain('item?.type === "enteredReviewMode"');
    expect(content).toContain('item?.type === "exitedReviewMode"');
    expect(content).toContain(
      "item?.turnId === reviewBackendTurnStart?.turnId",
    );
  });

  it("drives FileChange decline and cancel through the typed server request", () => {
    const content = readSmokeScript();

    expect(content).toContain("FILE_CHANGE_BATCH_SCENARIO");
    expect(content).toContain("renderFileChangeGateBBackendScript()");
    expect(content).toContain("startFileChangeBatchTurnFromGui");
    expect(content).toContain('"lime:debug:claw-trace-enabled:v1"');
    expect(content).toContain(
      '"lime:debug:app-server-server-request-lifecycle:v1"',
    );
    expect(content).toContain("fileChangeBatchLifecycleTraceEnabled");
    expect(content).toContain('logStage("file-change-batch-decline")');
    expect(content).toContain('logStage("file-change-batch-cancel")');
    expect(content).toContain("waitForFileChangeApprovalPending");
    expect(content).toContain("clickFileChangeApprovalDecision");
    expect(content).toContain("waitForFileChangeTerminalReadModel");
    expect(content).toContain("waitForFileChangeTerminalGui");
    expect(content).toContain("declineTurnCompleted");
    expect(content).toContain("cancelTurnInterrupted");
    expect(content).toContain("pendingCleared");
  });

  it("always replaces backend ledger evidence on a failed Gate B run", () => {
    const content = readSmokeScript();
    const catchStart = content.indexOf(
      "  } catch (error) {",
      content.indexOf("async function run()"),
    );
    const finallyStart = content.indexOf("  } finally {", catchStart);
    const failureBranch = content.slice(catchStart, finallyStart);

    expect(content).toContain("function persistBackendLedgerEvidence(");
    expect(failureBranch).toContain("persistBackendLedgerEvidence(");
    expect(failureBranch).toContain("summary.backendKinds =");
    expect(failureBranch).toContain("summary.backendEmittedEventTypes =");
    expect(failureBranch.indexOf("persistBackendLedgerEvidence(")).toBeLessThan(
      failureBranch.indexOf("writeJsonFile(summaryPath, summary)"),
    );
  });

  it("rejects retired workbench navigation and synthetic recovery contracts", () => {
    const content = readSmokeScript();
    for (const retired of [
      "task-center-workbench-toggle",
      "task-center-tab-workbench",
      "task-center-chrome-shell",
      "theme-workbench-harness-toggle",
      "toggle-harness",
      "general-workbench-sidebar",
      "artifact-workbench-shell",
      "canvas-workbench-shell",
      "canvas-workbench-layout",
      "data-canvas-tab-key",
      "canvas-workbench-panel-outputs",
      "canvas-workbench-panel-logs",
      "coding-workbench-recovery-submit",
      "coding_workbench_recovery",
      "coding-workbench-recovery/v1",
      "hasSessionWorkbenchAnchor",
      "openWorkbench",
    ]) {
      expect(content, retired).not.toContain(retired);
    }
  });

  it("binds the executed sidecar to fresh artifacts and keeps drift a failed Gate", () => {
    const content = readSmokeScript();

    expect(content).toContain("electronAppServerBinaryDestination");
    expect(content).not.toContain("resolveDevAppServerBinary");
    expect(content).toContain("inspectElectronFixtureBuildFreshness");
    expect(content).toContain(
      "file.file === summary.appServerExecutableRelativePath",
    );
    expect(content).toContain("summary.appServerExecutableSha256");
    const finalGate = content.slice(content.lastIndexOf("    summary.ok ="));
    expect(finalGate).toContain("summary.assertions.artifactInputsStable");
    expect(finalGate).toContain("summary.assertions.normalMainExit");
  });

  it("does not use legacy commands or renderer mock fallback as success evidence", () => {
    const content = readSmokeScript();

    expect(content).not.toContain("agent_runtime_");
    expect(content).not.toContain("mockPriorityCommands");
    expect(content).not.toContain("defaultMocks");
    expect(content).not.toContain("invokeMockOnly");
    expect(content).not.toContain("safeInvoke(");
  });
});
