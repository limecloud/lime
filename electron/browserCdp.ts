import type { BrowserTabPolicy } from "./browserTabPolicy";
import {
  assertCurrentTarget,
  executeEmulatedTargetCommand,
  getDebuggerFrameTargetInfos,
  isEmulatedTargetCommand,
  type BrowserCdpTargets,
} from "./browserCdpTargets";
import {
  readCdpTarget,
  type BrowserCdpTarget,
  type BrowserCdpTargetSession,
} from "./browserCdpSessions";
import type {
  BrowserTabState,
  BrowserToolCall,
  BrowserToolResult,
} from "./browserTabHost";

interface CdpContext {
  policy: BrowserTabPolicy;
  targets: BrowserCdpTargets;
  locale: string;
  url: () => string;
  assertCurrent: () => void;
  attach: () => Promise<void>;
  sendDebuggerCommand: (
    method: string,
    params: Record<string, unknown>,
    target?: BrowserCdpTarget,
  ) => Promise<unknown>;
  resolveTarget: (target: BrowserCdpTarget) => BrowserCdpTargetSession;
  attachTarget: (
    targetId: string,
    assertActive: () => void,
  ) => Promise<unknown>;
  detachTarget: (targetId: string) => Promise<void>;
  detach: () => void;
  runAgentInput: (action: () => Promise<unknown>) => Promise<unknown>;
  refreshSettings: () => Promise<void>;
  invalidateSnapshot: () => void;
  release: () => void;
  state: () => BrowserTabState;
  requestApproval: (reason: string) => BrowserToolResult;
}

const approvalText = {
  "zh-CN": (method: string) => `允许 Agent 在当前网页执行 CDP 命令 ${method}`,
  "zh-TW": (method: string) => `允許 Agent 在目前網頁執行 CDP 命令 ${method}`,
  "en-US": (method: string) =>
    `Allow the Agent to execute CDP command ${method} on the current page`,
  "ja-JP": (method: string) =>
    `現在のページで Agent による CDP コマンド ${method} の実行を許可`,
  "ko-KR": (method: string) =>
    `현재 페이지에서 Agent의 CDP 명령 ${method} 실행 허용`,
} as const;

export const isBrowserCdpTool = (tool: string): boolean =>
  ["executeCdpCommand", "attachTarget", "detachTarget"].includes(tool);

// Cross-origin cookies and other persistent debugger overrides still require
// their own command scope. Target sessions inherit the current tab/turn lifetime.
const pageCommands = new Set([
  "Runtime.evaluate",
  "Page.navigate",
  "Page.navigateToHistoryEntry",
  "Page.getNavigationHistory",
  "Page.reload",
  "Page.stopLoading",
  "Page.getLayoutMetrics",
  "Page.captureScreenshot",
  "Input.dispatchMouseEvent",
  "Input.dispatchKeyEvent",
  "Input.insertText",
  "Target.setAutoAttach",
]);

function readCommand(call: BrowserToolCall) {
  const lifecycle =
    call.tool === "attachTarget" || call.tool === "detachTarget";
  const { timeoutMs = 10_000 } = call.arguments;
  const method =
    call.tool === "attachTarget"
      ? "Target.attachToTarget"
      : call.tool === "detachTarget"
        ? "Target.detachFromTarget"
        : call.arguments.method;
  const commandParams = lifecycle
    ? { targetId: call.arguments.targetId }
    : call.arguments.commandParams === undefined
      ? {}
      : call.arguments.commandParams;
  if (
    lifecycle &&
    (typeof call.arguments.targetId !== "string" ||
      !call.arguments.targetId ||
      /\s/u.test(call.arguments.targetId))
  )
    throw new Error("Browser CDP attachment requires a targetId");
  const target = readCdpTarget(call.arguments.target);
  if (lifecycle && target !== undefined)
    throw new Error(
      "Browser CDP attachment cannot override its target selection",
    );
  if (
    typeof method !== "string" ||
    method.length > 128 ||
    !/^[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*$/u.test(method)
  )
    throw new Error("Browser CDP requires a domain and command name");
  if (
    !commandParams ||
    typeof commandParams !== "object" ||
    Array.isArray(commandParams)
  )
    throw new Error("Browser CDP commandParams must be an object");
  if (
    !Number.isInteger(timeoutMs) ||
    (timeoutMs as number) < 1 ||
    (timeoutMs as number) > 30_000
  )
    throw new Error("Browser CDP timeoutMs must be between 1 and 30000");
  if (
    (!lifecycle &&
      !pageCommands.has(method) &&
      !isEmulatedTargetCommand(method)) ||
    [
      "browserContextId",
      "frameId",
      "contextId",
      "executionContextId",
      "uniqueContextId",
      "scriptToEvaluateOnLoad",
    ].some((key) => Object.hasOwn(commandParams, key))
  )
    throw new Error(
      `Browser CDP command is outside the current page: ${method}`,
    );
  if (
    method === "Target.setAutoAttach" &&
    (typeof (commandParams as Record<string, unknown>).autoAttach !==
      "boolean" ||
      (commandParams as Record<string, unknown>).flatten !== true ||
      (commandParams as Record<string, unknown>).waitForDebuggerOnStart !==
        false)
  )
    throw new Error(
      "Browser CDP auto-attach requires flattened sessions without pausing targets",
    );
  return {
    method,
    params: structuredClone(commandParams) as Record<string, unknown>,
    timeoutMs: timeoutMs as number,
    target,
    lifecycle,
  };
}

function assertCurrentPageAllowed(context: CdpContext, url = context.url()) {
  context.assertCurrent();
  if (!context.policy.enabled || !context.policy.allows("debug", url))
    throw new Error("Browser full CDP access is denied for this page");
}

function assertNavigationAllowed(
  context: CdpContext,
  method: string,
  params: Record<string, unknown>,
) {
  if (method !== "Page.navigate") return;
  if (
    typeof params.url !== "string" ||
    !/^https?:\/\//iu.test(params.url) ||
    context.policy.decision("browse", params.url) === "deny" ||
    !context.policy.allows("debug", params.url)
  )
    throw new Error("Browser CDP navigation destination is denied");
}

/** CDP remains a turn-owned action on the existing visible WebContents. */
export async function executeCdpCommand(
  call: BrowserToolCall,
  approved: boolean,
  context: CdpContext,
): Promise<BrowserToolResult> {
  const { method, params, timeoutMs, target, lifecycle } = readCommand(call);
  assertCurrentPageAllowed(context);
  assertNavigationAllowed(context, method, params);
  assertCurrentTarget(method, params, context.targets);
  const logicalTargetId = `browser-use-iab-tab:${context.targets.current().tabId}`;
  const selection =
    target &&
    (target.sessionId !== undefined ||
      (target.targetId !== undefined && target.targetId !== logicalTargetId))
      ? target
      : undefined;
  if (selection && isEmulatedTargetCommand(method))
    throw new Error(`${method} can only access the current in-app browser tab`);
  const selectedTarget = selection
    ? context.resolveTarget(selection)
    : undefined;
  if (!approved) {
    const locale = Object.hasOwn(approvalText, context.locale)
      ? (context.locale as keyof typeof approvalText)
      : "en-US";
    return context.requestApproval(approvalText[locale](method));
  }

  const revision = context.policy.revision;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  const assertActive = () => {
    if (expired) throw new Error("Browser CDP command timed out");
    assertCurrentPageAllowed(context);
    if (context.policy.revision !== revision)
      throw new Error("Browser CDP policy changed during command execution");
    if (selection && selectedTarget) {
      const current = context.resolveTarget(selection);
      if (
        current.targetId !== selectedTarget.targetId ||
        current.sessionId !== selectedTarget.sessionId
      )
        throw new Error(
          "Browser CDP frame session changed during command execution",
        );
    }
  };
  const command = async () => {
    if (method !== "Target.getTargetInfo" && method !== "Target.closeTarget")
      await context.attach();
    assertActive();
    assertCurrentTarget(method, params, context.targets);
    assertNavigationAllowed(context, method, params);
    const frameTargetId = lifecycle
      ? String(params.targetId)
      : selectedTarget?.targetId;
    if (frameTargetId && frameTargetId !== logicalTargetId) {
      const frames = await getDebuggerFrameTargetInfos({
        ...context,
        assertActive,
      });
      assertActive();
      if (
        !frames.some((frame) => (frame.targetId ?? frame.id) === frameTargetId)
      )
        throw new Error("Browser CDP frame target is unavailable or denied");
    }
    if (method === "Page.navigateToHistoryEntry") {
      const history = (await (selection
        ? context.sendDebuggerCommand(
            "Page.getNavigationHistory",
            {},
            selection,
          )
        : context.sendDebuggerCommand("Page.getNavigationHistory", {}))) as {
        entries?: Array<{ id: number; url: string }>;
      };
      assertActive();
      const entry = history?.entries?.find(
        (item) => item.id === params.entryId,
      );
      if (!entry)
        throw new Error("Browser CDP navigation entry is unavailable");
      assertNavigationAllowed(context, "Page.navigate", { url: entry.url });
    }
    const run = () =>
      selection
        ? context.sendDebuggerCommand(method, params, selection)
        : context.sendDebuggerCommand(method, params);
    let result: unknown;
    if (lifecycle) {
      if (method === "Target.attachToTarget") {
        result =
          frameTargetId === logicalTargetId
            ? { targetId: logicalTargetId, attached: true }
            : await context.attachTarget(String(frameTargetId), assertActive);
      } else {
        if (frameTargetId === logicalTargetId) context.detach();
        else await context.detachTarget(String(frameTargetId));
        result = { targetId: frameTargetId, detached: true };
      }
    } else
      result = isEmulatedTargetCommand(method)
        ? await executeEmulatedTargetCommand(method, {
            ...context,
            assertActive,
          })
        : method.startsWith("Input.")
          ? await context.runAgentInput(run)
          : await run();
    // External administrator edits can revoke access while the native promise
    // is pending; do not project its result before rereading that authority.
    assertActive();
    await context.refreshSettings();
    assertActive();
    if (method === "Target.closeTarget") {
      context.targets.close();
      return { status: "completed" as const, data: result };
    }
    context.invalidateSnapshot();
    return {
      status: "completed" as const,
      data: result,
      state: context.state(),
    };
  };
  try {
    return await Promise.race([
      command(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          const error = new Error(`Browser CDP command timed out: ${method}`);
          try {
            context.release();
          } catch (cause) {
            error.cause = cause;
          }
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
