import {
  clickApprovalDecision,
  readMutationCount,
  waitForApprovalPrompt,
} from "./browser-runtime-electron-gate-b-approval.mjs";
import { updateConfigFromPage } from "../lib/chat-fixture/rpc.mjs";
import { assert, sanitizeJson } from "../lib/chat-fixture/utils.mjs";

/** Lifecycle fixtures opt into allow; the dedicated approval scenario keeps production ask. */
export async function configureBrowserFixturePermissions(
  page,
  options,
  requestLog,
) {
  if (["browse-approval", "first-open-approval"].includes(options.scenario))
    return;
  await updateConfigFromPage(
    page,
    (config) => ({
      ...config,
      browser: {
        ...config.browser,
        approvalMode: "neverAsk",
        ...(["download", "artifact"].includes(options.scenario)
          ? { downloadApprovalMode: "neverAsk" }
          : {}),
      },
    }),
    requestLog,
  );
}

export function prepareBrowserBrowseApproval({
  page,
  providerFixture,
  requestLog,
  origin,
}) {
  const record = {
    origin,
    policyUpdated: false,
    initial: null,
    actionBrowse: null,
    action: null,
  };
  providerFixture.scenario.beforeSensitiveAction = async () => {
    await updateConfigFromPage(
      page,
      (config) => ({
        ...config,
        browser: {
          ...config.browser,
          approvalMode: "alwaysAsk",
          allowedOrigins: [],
          deniedOrigins: [],
        },
        browser_use: {
          ...config.browser_use,
          origins: {
            ...config.browser_use?.origins,
            [origin]: {
              ...config.browser_use?.origins?.[origin],
              access: "allow",
            },
          },
        },
      }),
      requestLog,
    );
    record.policyUpdated = true;
  };
  return record;
}

async function pendingBrowserCall(app) {
  return app.evaluate(() => {
    const control = globalThis.__appServerE2E;
    if (!control?.pendingBrowserApprovals)
      throw new Error("Native Browser approval inspection unavailable");
    const pending = control.pendingBrowserApprovals();
    if (pending.length !== 1)
      throw new Error(`Expected one native approval, found ${pending.length}`);
    return pending[0];
  });
}

export async function approveBrowserBrowse({
  app,
  page,
  options,
  record,
  initial,
  readBrowserDebuggerState,
  readBrowserWorkspaceState,
}) {
  const prompt = await waitForApprovalPrompt(
    page,
    options,
    record.initial?.prompt.interactionId,
  );
  const pending = await pendingBrowserCall(app);
  const state = await readBrowserWorkspaceState(page);
  const debuggerState = await readBrowserDebuggerState(
    app,
    state.webContentsId,
  );
  const mutationCount = await readMutationCount(app, state.webContentsId);
  assert(
    prompt.summary.includes(record.origin),
    "Browse approval did not name the exact origin",
  );
  assert(
    pending.tool === (initial ? "claimTab" : "click"),
    "Browse approval changed the original tool",
  );
  assert(
    pending.kind === "browse",
    "Expected an independent browse permission stage",
  );
  assert(mutationCount === 0, "Page mutated before browse/action approval");
  if (initial) {
    assert(
      state.controlOwner !== "agent" && state.activeTurnId === null,
      "Unapproved claim acquired Agent control",
    );
    assert(
      debuggerState.attached === false,
      "Unapproved claim attached the page debugger",
    );
  } else
    assert(
      record.policyUpdated,
      "Site policy was not changed before reapproval",
    );
  const decision = await clickApprovalDecision(
    page,
    prompt.interactionId,
    "allow_once",
  );
  const capture = {
    prompt,
    pending,
    state,
    debuggerState,
    mutationCount,
    decision,
  };
  if (initial) record.initial = capture;
  else record.actionBrowse = capture;
}

export async function captureBrowserActionApproval(app, prompt, record) {
  record.action = { prompt, pending: await pendingBrowserCall(app) };
}

function lineage(call) {
  if (!call) return null;
  return Object.fromEntries(
    [
      "callId",
      "tool",
      "threadId",
      "turnId",
      "browserSessionId",
      "tabId",
      "viewId",
      "webContentsId",
      "snapshotId",
      "pageRevision",
      "accessApprovalLifetime",
      "policyRevision",
    ].map((key) => [key, call[key] ?? null]),
  );
}

export function joinBrowserBrowseEvidence(evidence, record) {
  const before = record.actionBrowse?.pending;
  const action = record.action?.pending;
  const initial = record.initial;
  const checks = {
    browseApprovalBeforeControl:
      initial?.state.controlOwner !== "agent" &&
      initial?.state.activeTurnId === null,
    noDebuggerBeforeBrowseApproval: initial?.debuggerState.attached === false,
    threadLifetimeRequestedByHost: [initial?.pending, before].every(
      (pending) =>
        pending?.accessApprovalLifetime === "thread" &&
        Number.isSafeInteger(pending.policyRevision),
    ),
    sitePolicyChangeRevokedBrowseGrant:
      record.policyUpdated && before?.tool === "click",
    exactOriginShownInBothBrowsePrompts: [initial, record.actionBrowse].every(
      (item) => item?.prompt.summary.includes(record.origin),
    ),
    noMutationBeforeIndependentActionApproval:
      initial?.mutationCount === 0 && record.actionBrowse?.mutationCount === 0,
    browseThenActionSameCanonicalCall:
      Boolean(before && action) &&
      [
        "callId",
        "tool",
        "threadId",
        "turnId",
        "browserSessionId",
        "tabId",
        "viewId",
        "webContentsId",
        "pageRevision",
      ].every((key) => before[key] === action[key]) &&
      JSON.stringify(before.arguments) === JSON.stringify(action.arguments),
    eachStageUsesANewToken:
      Boolean(before?.approvalToken && action?.approvalToken) &&
      before.approvalToken !== action.approvalToken,
    separateCanonicalApprovalCards:
      Boolean(record.action?.prompt.interactionId) &&
      record.action.prompt.interactionId !==
        record.actionBrowse?.prompt.interactionId,
    independentActionStage:
      before?.kind === "browse" && action?.kind === "action",
  };
  const assertions = { ...evidence.assertions, ...checks };
  const failedAssertions = Object.entries(assertions)
    .filter(([, passed]) => !passed)
    .map(([key]) => key);
  return sanitizeJson({
    ...evidence,
    schemaVersion: "browser_runtime_electron_gate_b.browse.v1",
    status: failedAssertions.length ? "fail" : "pass",
    claimBoundary:
      "真实 Electron、preload/IPC、App Server/runtime 的 browse ask 与独立 action 审批；同一 click call 分阶段批准。未证明异步网页跳转审批、跨 origin iframe、live provider 或平台打包。",
    browse: {
      origin: record.origin,
      initial: {
        prompt: initial?.prompt,
        decision: initial?.decision,
        lineage: lineage(initial?.pending),
        debuggerAttached: initial?.debuggerState.attached,
      },
      afterPolicyChange: {
        prompt: record.actionBrowse?.prompt,
        decision: record.actionBrowse?.decision,
        lineage: lineage(before),
      },
      action: { prompt: record.action?.prompt, lineage: lineage(action) },
    },
    assertions,
    failedAssertions,
  });
}
