import { describe, expect, it } from "vitest";
import { buildCommonAssertions } from "./claw-chat-current-fixture-common-assertions.mjs";
import { isBrowserIdentityAligned } from "./claw-chat-current-fixture-runtime-surface-assertions.mjs";
import {
  APP_SERVER_METHOD_SESSION_LIST,
  APP_SERVER_METHOD_SESSION_READ,
  APP_SERVER_METHOD_SESSION_START,
  APP_SERVER_METHOD_SESSION_TURN_START,
  APP_SERVER_METHOD_WORKSPACE_RIGHT_SURFACE_REQUEST,
  INPUTBAR_RICH_RESTORE_PROMPT,
} from "./claw-chat-current-fixture-constants.mjs";

const SCENARIO_FLAGS = [
  "isCancelOnlyScenario",
  "isCancelThenContinueScenario",
  "isPlanScenario",
  "isGoalScenario",
  "isHomeHotpathScenario",
  "isImageCommandScenario",
  "isInputbarRichRestoreScenario",
  "isActiveSteerScenario",
  "isWebToolsRenderingScenario",
  "isLiveTailCommitScenario",
  "isElectronResizeReflowScenario",
  "isMcpStructuredContentScenario",
  "isMediaReferenceScenario",
  "isReasoningFirstVisibleScenario",
  "isTerminalCanceledAfterAnswerScenario",
  "isTerminalFailedAfterAnswerScenario",
  "isTerminalStaleGuardScenario",
  "isTypedErrorRetryScenario",
  "isTypedErrorRetrySuccessScenario",
  "isSkillsRuntimeScenario",
  "isRightSurfaceVisualMatrixScenario",
  "isThreadSummaryPanelScenario",
  "isContentFactoryArticleWorkspaceScenario",
  "isAnyExpertSkillsRuntimeScenario",
  "isApprovalRequestResumeScenario",
  "isApprovalRequestDeclineScenario",
  "isApprovalRequestCancelScenario",
  "isApprovalRequestDecisionScenario",
  "isApprovalRequestFullAccessScenario",
  "isExpertPlazaSkillsRuntimeScenario",
  "isExpertPanelSkillsRuntimeScenario",
  "hasCancelPhase",
];

function buildContext({ typedError = false, summary = {} } = {}) {
  return {
    rendererSnapshot: {},
    appServerRequestMethods: [],
    guiTurnStartReachedBackend: false,
    backendLedger: [],
    runtimeRequest: {},
    pageText: "",
    errorRaw: null,
    actionableConsoleErrors: [],
    summary,
    ...Object.fromEntries(SCENARIO_FLAGS.map((flag) => [flag, false])),
    isTypedErrorRetryScenario: typedError,
    isTypedErrorRetrySuccessScenario: typedError,
  };
}

function buildTraceSummary({
  hasClientLocalOutputMs = true,
  hasFirstVisibleOutputMs = true,
  hasFirstTextDeltaToFirstTextPaintMs = true,
  hasAppServerMessageDelta = true,
  hasServerEventEmittedAt = true,
  hasW3cTraceContext = true,
} = {}) {
  return {
    agentUiPerformanceTrace: {
      available: true,
      hasProviderWaitMs: false,
      hasClientLocalOutputMs,
      hasFirstVisibleOutputMs,
      hasFirstTextDeltaToFirstTextPaintMs,
      rawEntriesExported: false,
      forbiddenFragmentPresent: false,
    },
    appServerTraceEvidence: {
      available: true,
      hasProviderFirstTextDelta: false,
      hasAppServerMessageDelta,
      hasProviderWaitMs: false,
      hasServerEventEmittedAt,
      hasW3cTraceContext,
      forbiddenFragmentPresent: false,
    },
  };
}

describe.each([
  "isRightSurfaceVisualMatrixScenario",
  "isThreadSummaryPanelScenario",
])("read-only panel common contract: %s", (scenarioFlag) => {
  function panelContext() {
    return {
      ...buildContext(),
      [scenarioFlag]: true,
      rendererSnapshot: {
        electron: true,
        hasInvokeBridge: true,
        supportsAppServer: true,
      },
      appServerRequestMethods: [
        APP_SERVER_METHOD_SESSION_START,
        APP_SERVER_METHOD_SESSION_READ,
        APP_SERVER_METHOD_SESSION_LIST,
        ...(scenarioFlag === "isRightSurfaceVisualMatrixScenario"
          ? [APP_SERVER_METHOD_WORKSPACE_RIGHT_SURFACE_REQUEST]
          : []),
      ],
      summary: {
        rightSurfaceVisualMatrixSessionCreation: {
          sessionId: "panel-session",
          threadId: "panel-thread",
        },
        guiRightSurfaceVisualMatrixSessionOpened: {
          readModel: {
            hasThread: true,
            sessionId: "panel-session",
            threadId: "panel-thread",
            error: null,
          },
          inputReady: {
            editorSessionId: "panel-session",
            editorCount: 1,
            editorVisible: true,
            editorDisabled: false,
          },
        },
      },
    };
  }

  it("accepts a real bridge and matching read model without fabricated chat output", () => {
    const result = buildCommonAssertions(panelContext());
    expect(Object.values(result).every((passed) => passed === true)).toBe(true);
    expect(result).not.toHaveProperty("guiUserMessageVisible");
    expect(result).not.toHaveProperty("guiAssistantOutputVisible");
  });

  it.each([
    ["missing-bridge", "electronPreloadBridge"],
    ["missing-rpc", "appServerJsonRpcUsed"],
    ["wrong-thread", "rightSurfaceSessionReadModelAligned"],
    ["wrong-editor", "guiInputRemainsReady"],
    ["disabled-editor", "guiInputRemainsReady"],
    ["rpc-turn", "rightSurfaceDoesNotStartModelTurn"],
    ["backend-turn", "rightSurfaceDoesNotStartModelTurn"],
    ["invoke-error", "noInvokeErrors"],
    ["console-error", "noConsoleErrors"],
  ])("rejects %s evidence", (mode, assertion) => {
    const input = panelContext();
    const opened = input.summary.guiRightSurfaceVisualMatrixSessionOpened;
    if (mode === "missing-bridge")
      input.rendererSnapshot.hasInvokeBridge = false;
    if (mode === "missing-rpc") {
      const method =
        scenarioFlag === "isThreadSummaryPanelScenario"
          ? APP_SERVER_METHOD_SESSION_READ
          : APP_SERVER_METHOD_WORKSPACE_RIGHT_SURFACE_REQUEST;
      input.appServerRequestMethods = input.appServerRequestMethods.filter(
        (entry) => entry !== method,
      );
    }
    if (mode === "wrong-thread") opened.readModel.threadId = "foreign";
    if (mode === "wrong-editor") opened.inputReady.editorSessionId = "foreign";
    if (mode === "disabled-editor") opened.inputReady.editorDisabled = true;
    if (mode === "rpc-turn")
      input.appServerRequestMethods.push(APP_SERVER_METHOD_SESSION_TURN_START);
    if (mode === "backend-turn")
      input.backendLedger.push({ kind: "turnStart" });
    if (mode === "invoke-error") input.errorRaw = "invoke failed";
    if (mode === "console-error")
      input.actionableConsoleErrors.push("render failed");
    expect(buildCommonAssertions(input)[assertion]).toBe(false);
  });
});

describe("current native browser identity", () => {
  const url = "https://example.com/right-surface-browser";
  function capture() {
    return {
      stable: {
        browserSurface: {
          sessionId: "canonical-browser",
          tabId: "canonical-tab",
          threadId: "panel-thread",
          webContentsId: 5,
          controlOwner: "human",
        },
      },
      nativeTabs: [
        {
          browserSessionId: "canonical-browser",
          tabId: "canonical-tab",
          threadId: "panel-thread",
          webContentsId: 5,
          selected: true,
          controlOwner: "user",
          url,
        },
      ],
    };
  }

  it("requires the renderer projection to match the selected real native tab", () => {
    expect(isBrowserIdentityAligned(capture(), "panel-thread", url)).toBe(true);
    expect(isBrowserIdentityAligned(undefined, "panel-thread", url)).toBe(
      false,
    );
  });

  it.each([
    ["browserSessionId", "foreign"],
    ["tabId", "foreign"],
    ["threadId", "foreign"],
    ["webContentsId", 6],
    ["selected", false],
    ["controlOwner", "agent"],
    ["url", "https://example.com/foreign"],
  ])("rejects native %s drift", (field, value) => {
    const input = capture();
    input.nativeTabs[0][field] = value;
    expect(isBrowserIdentityAligned(input, "panel-thread", url)).toBe(false);
  });
});

describe("rich Composer restored readiness assertion", () => {
  function context() {
    const prepared = {
      editorCount: 1,
      editorSessionId: "rich-session",
      editorVisible: true,
      editorDisabled: false,
      hasInputbarCore: true,
      sendButtonExists: true,
      sendButtonDisabled: false,
      stopButtonVisible: false,
      editorText: `${INPUTBAR_RICH_RESTORE_PROMPT} [Pasted text 1: 1620 characters] $capability-report`,
      skillTokenData: [
        {
          id: "user:capability-report",
          name: "capability-report",
          path: "/fixture/.agents/skills/capability-report/SKILL.md",
          label: "$capability-report",
          editable: "false",
        },
      ],
    };
    return {
      ...buildContext({
        summary: {
          sessionId: "rich-session",
          inputbarRichRestoreDraftPrepared: { prepared },
          inputbarRichRestoreGuiCanceled: structuredClone(prepared),
        },
      }),
      isInputbarRichRestoreScenario: true,
    };
  }

  it("accepts the exact prepared rich draft with a unique same-session ready editor", () => {
    expect(buildCommonAssertions(context()).guiInputRemainsReady).toBe(true);
  });

  it.each([
    "wrong-session",
    "duplicate-editor",
    "hidden-editor",
    "disabled-editor",
    "missing-core",
    "missing-send",
    "disabled-send",
    "stop-active",
    "plain-prompt",
    "missing-paste",
    "missing-skill",
    "same-label-wrong-id",
    "same-label-wrong-path",
    "missing-token",
    "missing-prepared",
  ])("rejects %s restored evidence", (mode) => {
    const input = context();
    const restored = input.summary.inputbarRichRestoreGuiCanceled;
    if (mode === "wrong-session") restored.editorSessionId = "foreign";
    if (mode === "duplicate-editor") restored.editorCount = 2;
    if (mode === "hidden-editor") restored.editorVisible = false;
    if (mode === "disabled-editor") restored.editorDisabled = true;
    if (mode === "missing-core") restored.hasInputbarCore = false;
    if (mode === "missing-send") restored.sendButtonExists = false;
    if (mode === "disabled-send") restored.sendButtonDisabled = true;
    if (mode === "stop-active") restored.stopButtonVisible = true;
    if (mode === "plain-prompt")
      restored.editorText = INPUTBAR_RICH_RESTORE_PROMPT;
    if (mode === "missing-paste")
      restored.editorText = restored.editorText.replace(
        "[Pasted text 1: 1620 characters] ",
        "",
      );
    if (mode === "missing-skill")
      restored.editorText = restored.editorText.replace(
        " $capability-report",
        "",
      );
    if (mode === "same-label-wrong-id")
      restored.skillTokenData[0].id = "project:capability-report";
    if (mode === "same-label-wrong-path")
      restored.skillTokenData[0].path = "/foreign/SKILL.md";
    if (mode === "missing-token") restored.skillTokenData = [];
    if (mode === "missing-prepared")
      delete input.summary.inputbarRichRestoreDraftPrepared;
    expect(buildCommonAssertions(input).guiInputRemainsReady).toBe(false);
  });
});

describe("claw chat current fixture common trace assertions", () => {
  it("requires provider first-text evidence for ordinary text streaming", () => {
    const assertions = buildCommonAssertions(
      buildContext({ summary: buildTraceSummary() }),
    );

    expect(assertions.agentUiPerformanceTraceSeparatesProviderAndClient).toBe(
      false,
    );
    expect(assertions.appServerTraceEvidenceSeparatesProviderAndServer).toBe(
      false,
    );
    expect(
      assertions.appServerTraceEvidenceHasProviderFirstTextCheckpoint,
    ).toBe(false);
    expect(assertions.appServerTraceEvidenceHasProviderWaitMs).toBe(false);
    expect(assertions.appServerTraceEvidenceHasMessageDeltaCheckpoint).toBe(
      true,
    );
    expect(assertions.appServerTraceEvidenceHasServerEmissionTimestamp).toBe(
      true,
    );
  });

  it("does not require provider first-text evidence for typed error retries", () => {
    const assertions = buildCommonAssertions(
      buildContext({ typedError: true, summary: buildTraceSummary() }),
    );

    expect(assertions.agentUiPerformanceTraceSeparatesProviderAndClient).toBe(
      true,
    );
    expect(assertions.appServerTraceEvidenceSeparatesProviderAndServer).toBe(
      true,
    );
    expect(
      assertions.appServerTraceEvidenceHasProviderFirstTextCheckpoint,
    ).toBe(true);
    expect(assertions.appServerTraceEvidenceHasProviderWaitMs).toBe(true);
    expect(assertions.appServerTraceEvidenceHasMessageDeltaCheckpoint).toBe(
      true,
    );
    expect(assertions.appServerTraceEvidenceHasServerEmissionTimestamp).toBe(
      true,
    );
  });

  it("keeps non-provider trace evidence mandatory for typed error retries", () => {
    const assertions = buildCommonAssertions(
      buildContext({
        typedError: true,
        summary: buildTraceSummary({
          hasClientLocalOutputMs: false,
          hasFirstVisibleOutputMs: false,
          hasFirstTextDeltaToFirstTextPaintMs: false,
          hasAppServerMessageDelta: false,
          hasServerEventEmittedAt: false,
          hasW3cTraceContext: false,
        }),
      }),
    );

    expect(assertions.agentUiPerformanceTraceSeparatesProviderAndClient).toBe(
      false,
    );
    expect(assertions.agentUiPerformanceTraceHasFirstVisibleTextPaint).toBe(
      false,
    );
    expect(assertions.appServerTraceEvidenceSeparatesProviderAndServer).toBe(
      false,
    );
    expect(assertions.appServerTraceEvidenceHasMessageDeltaCheckpoint).toBe(
      false,
    );
    expect(assertions.appServerTraceEvidenceHasServerEmissionTimestamp).toBe(
      false,
    );
    expect(assertions.appServerTraceEvidenceUsesCurrentMethods).toBe(false);
    expect(assertions.appServerTraceEvidenceHasW3cCarrier).toBe(false);
  });
});
