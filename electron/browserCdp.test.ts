import { afterEach, expect, it, vi } from "vitest";
import { executeCdpCommand } from "./browserCdp";
import { BrowserTabPolicy } from "./browserTabPolicy";
import { effectiveBrowserSettings } from "../src/lib/api/browserSettingsTypes";
import type { BrowserTabState, BrowserToolCall } from "./browserTabHost";

const call = (args: Record<string, unknown> = {}): BrowserToolCall => ({
  arguments: { method: "Runtime.evaluate", ...args },
  callId: "cdp-1",
  ownerWebContentsId: 41,
  phase: "preflight",
  threadId: "thread-1",
  tool: "executeCdpCommand",
  turnId: "turn-1",
});

function context() {
  const policy = new BrowserTabPolicy();
  policy.setSettings(effectiveBrowserSettings({ fullCdpAccessEnabled: true }));
  return {
    policy,
    locale: "en-US",
    url: () => "https://example.com/",
    assertCurrent: vi.fn(),
    attach: vi.fn(async () => undefined),
    sendDebuggerCommand: vi.fn(async () => ({ result: { value: 42 } })),
    runAgentInput: vi.fn(async (action: () => Promise<unknown>) => action()),
    refreshSettings: vi.fn(async () => undefined),
    invalidateSnapshot: vi.fn(),
    release: vi.fn(),
    state: vi.fn(() => ({ tabId: "tab-1" }) as BrowserTabState),
    requestApproval: vi.fn((reason: string) => ({
      status: "approval_required" as const,
      data: { reason },
    })),
  };
}

afterEach(() => vi.useRealTimers());

it.each([
  ["zh-CN", "当前网页"],
  ["zh-TW", "目前網頁"],
  ["en-US", "current page"],
  ["ja-JP", "現在のページ"],
  ["ko-KR", "현재 페이지"],
])(
  "requires localized canonical approval before attaching: %s",
  async (locale, text) => {
    const c = context();
    c.locale = locale;
    await expect(executeCdpCommand(call(), false, c)).resolves.toMatchObject({
      status: "approval_required",
      data: { reason: expect.stringContaining(text) },
    });
    expect(c.requestApproval).toHaveBeenCalledWith(
      expect.stringContaining("Runtime.evaluate"),
    );
    expect(c.attach).not.toHaveBeenCalled();
    expect(c.sendDebuggerCommand).not.toHaveBeenCalled();
  },
);

it("executes only after approval and rechecks policy before projecting native data", async () => {
  const c = context();
  const params = { expression: "6 * 7", returnByValue: true };
  await expect(
    executeCdpCommand(call({ commandParams: params }), true, c),
  ).resolves.toEqual({
    status: "completed",
    data: { result: { value: 42 } },
    state: { tabId: "tab-1" },
  });
  expect(c.sendDebuggerCommand).toHaveBeenCalledExactlyOnceWith(
    "Runtime.evaluate",
    params,
  );
  expect(c.refreshSettings).toHaveBeenCalledOnce();
  expect(c.invalidateSnapshot).toHaveBeenCalledOnce();
});

it.each([
  "Browser.close",
  "Target.attachToTarget",
  "Storage.getCookies",
  "DOM.setFileInputFiles",
  "Input.dispatchTouchEvent",
  "Network.getCookies",
  "Network.setCookie",
  "Page.addScriptToEvaluateOnNewDocument",
  "Emulation.setDeviceMetricsOverride",
  "Fetch.enable",
  "Future.unknownCommand",
])(
  "refuses commands whose ownership is not the current page: %s",
  async (method) => {
    const c = context();
    await expect(
      executeCdpCommand(call({ method }), false, c),
    ).rejects.toThrow();
    expect(c.requestApproval).not.toHaveBeenCalled();
    expect(c.attach).not.toHaveBeenCalled();
  },
);

it.each([
  { contextId: 1 },
  { uniqueContextId: "another-frame" },
  { frameId: "another-frame" },
  { browserContextId: "another-profile" },
])("refuses explicit scope selection before approval: %j", async (params) => {
  const c = context();
  await expect(
    executeCdpCommand(call({ commandParams: params }), false, c),
  ).rejects.toThrow("outside the current page");
  expect(c.requestApproval).not.toHaveBeenCalled();
  expect(c.attach).not.toHaveBeenCalled();
});

it.each([
  "file:///private/example",
  "javascript:alert(1)",
  "data:text/html,example",
])("refuses non-web navigation before approval: %s", async (url) => {
  const c = context();
  await expect(
    executeCdpCommand(
      call({ method: "Page.navigate", commandParams: { url } }),
      false,
      c,
    ),
  ).rejects.toThrow("destination is denied");
  expect(c.attach).not.toHaveBeenCalled();
  expect(c.requestApproval).not.toHaveBeenCalled();
});

it("denies a managed navigation destination before requesting approval", async () => {
  const c = context();
  c.policy.setSettings(
    effectiveBrowserSettings({ fullCdpAccessEnabled: true }, null, {
      browserUse: { origins: { "blocked.example.com": { access: "deny" } } },
    }),
  );
  await expect(
    executeCdpCommand(
      call({
        method: "Page.navigate",
        commandParams: { url: "https://blocked.example.com" },
      }),
      false,
      c,
    ),
  ).rejects.toThrow("destination is denied");
  expect(c.attach).not.toHaveBeenCalled();
  expect(c.requestApproval).not.toHaveBeenCalled();
});

it("checks the native history destination before navigating", async () => {
  const c = context();
  c.policy.setSettings(
    effectiveBrowserSettings({ fullCdpAccessEnabled: true }, null, {
      browserUse: {
        origins: { "blocked.example.com": { fullCdpAccess: "deny" } },
      },
    }),
  );
  c.sendDebuggerCommand.mockResolvedValue({
    entries: [{ id: 7, url: "https://blocked.example.com/" }],
  } as never);
  await expect(
    executeCdpCommand(
      call({
        method: "Page.navigateToHistoryEntry",
        commandParams: { entryId: 7 },
      }),
      true,
      c,
    ),
  ).rejects.toThrow("destination is denied");
  expect(c.sendDebuggerCommand).toHaveBeenCalledExactlyOnceWith(
    "Page.getNavigationHistory",
    {},
  );
  expect(c.invalidateSnapshot).not.toHaveBeenCalled();
});

it.each([
  { method: "Runtime.evaluate; Browser.close" },
  { commandParams: [] },
  { commandParams: null },
  { timeoutMs: 0 },
  { timeoutMs: 30_001 },
  { timeoutMs: 1.5 },
])("rejects malformed command contracts before approval: %j", async (args) => {
  const c = context();
  await expect(executeCdpCommand(call(args), false, c)).rejects.toThrow();
  expect(c.attach).not.toHaveBeenCalled();
  expect(c.requestApproval).not.toHaveBeenCalled();
});

it("suppresses native data after an administrator revokes access during IO", async () => {
  const c = context();
  c.refreshSettings.mockImplementation(async () => {
    c.policy.setSettings(
      effectiveBrowserSettings({ fullCdpAccessEnabled: true }, null, {
        allowBrowserAndComputerUse: false,
      }),
    );
  });
  await expect(executeCdpCommand(call(), true, c)).rejects.toThrow("denied");
  expect(c.sendDebuggerCommand).toHaveBeenCalledOnce();
  expect(c.invalidateSnapshot).not.toHaveBeenCalled();
});

it("keeps native CDP input inside the existing Agent input observer", async () => {
  const c = context();
  await executeCdpCommand(
    call({ method: "Input.insertText", commandParams: { text: "example" } }),
    true,
    c,
  );
  expect(c.runAgentInput).toHaveBeenCalledOnce();
});

it("releases control at the deadline and never projects a late native result", async () => {
  vi.useFakeTimers();
  const c = context();
  let resolve!: (value: { result: { value: number } }) => void;
  c.sendDebuggerCommand.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const result = executeCdpCommand(call({ timeoutMs: 20 }), true, c);
  const rejected = expect(result).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(20);
  await rejected;
  expect(c.release).toHaveBeenCalledOnce();
  resolve({ result: { value: 99 } });
  await vi.runAllTimersAsync();
  expect(c.invalidateSnapshot).not.toHaveBeenCalled();
  expect(c.state).not.toHaveBeenCalled();
  expect(c.refreshSettings).not.toHaveBeenCalled();
});

it("settles the deadline even when native teardown throws", async () => {
  vi.useFakeTimers();
  const c = context();
  c.sendDebuggerCommand.mockImplementation(() => new Promise(() => {}));
  c.release.mockImplementation(() => {
    throw new Error("native view destroyed");
  });
  const result = executeCdpCommand(call({ timeoutMs: 20 }), true, c);
  const rejected = expect(result).rejects.toMatchObject({
    message: "Browser CDP command timed out: Runtime.evaluate",
    cause: expect.objectContaining({ message: "native view destroyed" }),
  });
  await vi.advanceTimersByTimeAsync(20);
  await rejected;
  expect(c.release).toHaveBeenCalledOnce();
  expect(c.invalidateSnapshot).not.toHaveBeenCalled();
});
