import type { BrowserTabPolicy } from "./browserTabPolicy";
import type {
  BrowserTabState,
  BrowserToolCall,
  BrowserToolResult,
} from "./browserTabHost";

interface CdpContext {
  policy: BrowserTabPolicy;
  locale: string;
  url: () => string;
  assertCurrent: () => void;
  attach: () => Promise<void>;
  sendDebuggerCommand: (
    method: string,
    params: Record<string, unknown>,
  ) => Promise<unknown>;
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

// Each admitted command has a page/turn lifetime. Target sessions, cross-origin
// cookie access and persistent debugger overrides need their own scope owner.
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
]);

function readCommand(call: BrowserToolCall) {
  const { method, commandParams = {}, timeoutMs = 10_000 } = call.arguments;
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
    !pageCommands.has(method) ||
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
  return {
    method,
    params: structuredClone(commandParams) as Record<string, unknown>,
    timeoutMs: timeoutMs as number,
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
  const { method, params, timeoutMs } = readCommand(call);
  assertCurrentPageAllowed(context);
  assertNavigationAllowed(context, method, params);
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
  };
  const command = async () => {
    await context.attach();
    assertActive();
    assertNavigationAllowed(context, method, params);
    if (method === "Page.navigateToHistoryEntry") {
      const history = (await context.sendDebuggerCommand(
        "Page.getNavigationHistory",
        {},
      )) as { entries?: Array<{ id: number; url: string }> };
      assertActive();
      const entry = history?.entries?.find(
        (item) => item.id === params.entryId,
      );
      if (!entry)
        throw new Error("Browser CDP navigation entry is unavailable");
      assertNavigationAllowed(context, "Page.navigate", { url: entry.url });
    }
    const run = () => context.sendDebuggerCommand(method, params);
    const result = method.startsWith("Input.")
      ? await context.runAgentInput(run)
      : await run();
    // External administrator edits can revoke access while the native promise
    // is pending; do not project its result before rereading that authority.
    assertActive();
    await context.refreshSettings();
    assertActive();
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
