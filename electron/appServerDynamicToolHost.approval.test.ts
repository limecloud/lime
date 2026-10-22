import { describe, expect, it, vi } from "vitest";
import type {
  DynamicToolCallResponse,
  JsonRpcMessage,
} from "@limecloud/app-server-client";
import type { BrowserToolCall, BrowserToolResult } from "./browserTabHost";

vi.mock("./electronRuntime", () => ({ app: {} }));

import { AppServerDynamicToolHost } from "./appServerDynamicToolHost";

const argumentsValue = {
  backendNodeId: 11,
  snapshotId: "snapshot-1",
  tabId: "tab-1",
};
function call(overrides: Record<string, unknown> = {}): JsonRpcMessage {
  return {
    id: "request-1",
    method: "item/tool/call",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "call-1",
      namespace: "browser",
      tool: "click",
      arguments: { ...argumentsValue },
      phase: "preflight",
      ...overrides,
    },
  };
}
function approval(token: string, actionKind = "browse"): BrowserToolResult {
  return {
    status: "approval_required",
    approval: {
      actionKind,
      approvalToken: token,
      browserSessionId: "browser-session-1",
      reason: `Approve ${actionKind}`,
      riskClass: actionKind,
      snapshotId: "snapshot-1",
      tabId: "tab-1",
      viewId: "view-1",
      webContentsId: 100,
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup() {
  const browser = {
    executeTool: vi
      .fn<(call: BrowserToolCall) => Promise<BrowserToolResult>>()
      .mockResolvedValue({ status: "completed" }),
    turnEnded: vi.fn(),
    connectionLost: vi.fn(),
  };
  const host = new AppServerDynamicToolHost(undefined, browser as never);
  const connection = {
    respondServerRequest: vi.fn(),
    rejectServerRequest: vi.fn(),
  };
  const bind = () =>
    host.observeClientResult(
      "thread/resume",
      { thread: { id: "thread-1" } },
      { ownerWebContentsId: 41 },
    );
  bind();
  const send = (overrides: Record<string, unknown> = {}) =>
    host.tryHandle(connection, call(overrides));
  const approve = (token: string, overrides: Record<string, unknown> = {}) =>
    send({ phase: "approvedExecute", approvalToken: token, ...overrides });
  const response = () =>
    connection.respondServerRequest.mock.calls.at(-1)?.[1] as
      | DynamicToolCallResponse
      | undefined;
  return { host, browser, connection, send, approve, response, bind };
}

describe("Browser dynamic tool approval stages", () => {
  it("requires independent browsing and dangerous-action approvals before completing one frozen call", async () => {
    const { browser, send, approve, response, connection } = setup();
    browser.executeTool
      .mockResolvedValueOnce(approval("browse-token"))
      .mockResolvedValueOnce(approval("click-token", "high_impact_click"));
    await send();
    expect(response()?.approval?.approvalToken).toBe("browse-token");
    await approve("browse-token");
    expect(response()?.approval).toMatchObject({
      approvalToken: "click-token",
      actionKind: "high_impact_click",
    });
    await approve("browse-token");
    expect(browser.executeTool).toHaveBeenCalledTimes(2);
    await approve("click-token");
    expect(response()?.success).toBe(true);
    await approve("click-token");
    expect(browser.executeTool.mock.calls.map(([params]) => params)).toEqual([
      expect.objectContaining({
        phase: "preflight",
        arguments: argumentsValue,
      }),
      expect.objectContaining({
        phase: "approvedExecute",
        approvalToken: "browse-token",
        arguments: argumentsValue,
      }),
      expect.objectContaining({
        phase: "approvedExecute",
        approvalToken: "click-token",
        arguments: argumentsValue,
      }),
    ]);
    expect(connection.rejectServerRequest).toHaveBeenCalledTimes(2);
  });

  it("allows exactly four approvals followed by successful execution", async () => {
    const { browser, send, approve, response } = setup();
    for (let stage = 1; stage <= 4; stage += 1) {
      browser.executeTool.mockResolvedValueOnce(approval(`token-${stage}`));
    }
    await send();
    for (let stage = 1; stage <= 4; stage += 1) {
      expect(response()?.approval?.approvalToken).toBe(`token-${stage}`);
      await approve(`token-${stage}`);
    }
    expect(response()?.success).toBe(true);
    expect(browser.executeTool).toHaveBeenCalledTimes(5);
  });

  it("fails a fifth approval closed and consumes the call", async () => {
    const { browser, send, approve, response, connection } = setup();
    for (let stage = 1; stage <= 5; stage += 1) {
      browser.executeTool.mockResolvedValueOnce(approval(`token-${stage}`));
    }
    await send();
    for (let stage = 1; stage <= 4; stage += 1) await approve(`token-${stage}`);
    expect(response()).toMatchObject({
      success: false,
      contentItems: [
        {
          type: "inputText",
          text: expect.stringContaining("limit of 4 approvals"),
        },
      ],
    });
    expect(response()?.approval).toBeUndefined();
    await approve("token-5");
    await send();
    expect(browser.executeTool).toHaveBeenCalledTimes(5);
    expect(connection.rejectServerRequest).toHaveBeenCalledTimes(2);
  });

  it.each(["same-call", "another-call"])(
    "rejects an approval token repeated by the Browser owner for %s",
    async (scope) => {
      const { browser, send, approve, response, connection } = setup();
      browser.executeTool
        .mockResolvedValueOnce(approval("repeated"))
        .mockResolvedValueOnce(approval("repeated"));
      await send();
      if (scope === "same-call") await approve("repeated");
      else await send({ callId: "another-call" });
      expect(response()?.approval).toBeUndefined();
      expect(response()?.contentItems).toEqual([
        {
          type: "inputText",
          text: expect.stringContaining("repeated Browser approval token"),
        },
      ]);
      await approve(
        "repeated",
        scope === "same-call" ? {} : { callId: "another-call" },
      );
      expect(browser.executeTool).toHaveBeenCalledTimes(2);
      expect(connection.rejectServerRequest).toHaveBeenCalledTimes(1);
    },
  );

  it("matches the exact current token without trimming or consuming a valid pending stage", async () => {
    const { browser, send, approve, response, connection } = setup();
    browser.executeTool.mockResolvedValueOnce(approval("token-1"));
    await send();
    for (const token of ["wrong", " token-1", "token-1 ", "token-0"])
      await approve(token);
    expect(browser.executeTool).toHaveBeenCalledTimes(1);
    expect(connection.rejectServerRequest).toHaveBeenCalledTimes(4);
    await approve("token-1");
    expect(response()?.success).toBe(true);
  });

  it.each([
    { namespace: "desktop", tool: "appInfo", arguments: {} },
    { tool: "press", arguments: { key: "Escape", snapshotId: "snapshot-1" } },
    { arguments: { ...argumentsValue, backendNodeId: 12 } },
  ])("rejects changed call identity or arguments: %j", async (changed) => {
    const { browser, send, approve, response, connection } = setup();
    browser.executeTool.mockResolvedValueOnce(approval("token-1"));
    await send();
    await approve("token-1", changed);
    expect(connection.rejectServerRequest).toHaveBeenLastCalledWith(
      "request-1",
      expect.objectContaining({
        message: expect.stringContaining("frozen call"),
      }),
    );
    expect(browser.executeTool).toHaveBeenCalledTimes(1);
    await approve("token-1");
    expect(response()?.success).toBe(true);
  });

  it("captures arguments before awaiting the Browser and accepts equivalent key order", async () => {
    const { browser, send, approve, response } = setup();
    const pending = deferred<BrowserToolResult>();
    browser.executeTool.mockReturnValueOnce(pending.promise);
    const input = { ...argumentsValue };
    const running = send({ arguments: input });
    input.backendNodeId = 999;
    expect(browser.executeTool).toHaveBeenCalledWith(
      expect.objectContaining({ arguments: argumentsValue }),
    );
    pending.resolve(approval("token-1"));
    await running;
    await approve("token-1", {
      arguments: {
        tabId: "tab-1",
        snapshotId: "snapshot-1",
        backendNodeId: 11,
      },
    });
    expect(response()?.success).toBe(true);
  });

  it("rejects concurrent preflight and approved execution as well as completed replays", async () => {
    const { browser, send, approve, connection } = setup();
    const first = deferred<BrowserToolResult>();
    const second = deferred<BrowserToolResult>();
    browser.executeTool
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const preflight = send();
    await send();
    await approve("token-1");
    first.resolve(approval("token-1"));
    await preflight;
    const executing = approve("token-1");
    await approve("token-1");
    await send();
    second.resolve({ status: "completed" });
    await executing;
    await approve("token-1");
    await send();
    expect(browser.executeTool).toHaveBeenCalledTimes(2);
    expect(connection.rejectServerRequest).toHaveBeenCalledTimes(6);
  });

  it.each(["preflight", "approvedExecute"] as const)(
    "does not restore %s approval after the turn ends or permit a new call in that closed turn",
    async (phase) => {
      const { host, browser, send, approve, response, connection } = setup();
      const pending = deferred<BrowserToolResult>();
      if (phase === "approvedExecute") {
        browser.executeTool.mockResolvedValueOnce(approval("initial-token"));
        await send();
      }
      browser.executeTool.mockReturnValueOnce(pending.promise);
      const running = phase === "preflight" ? send() : approve("initial-token");
      host.observeServerMessage({
        method: "turn/completed",
        params: {
          threadId: "thread-1",
          turn: { id: "turn-1", status: "interrupted" },
        },
      });
      pending.resolve(approval("late-token"));
      await running;
      expect(response()?.approval).toBeUndefined();
      expect(response()?.success).toBe(false);
      await approve("late-token");
      await send({ callId: "new-call" });
      expect(browser.executeTool).toHaveBeenCalledTimes(
        phase === "preflight" ? 1 : 2,
      );
      expect(connection.rejectServerRequest).toHaveBeenCalledTimes(2);
      await send({ turnId: "turn-2" });
      expect(response()?.success).toBe(true);
    },
  );

  it.each([
    ["reset", "preflight"],
    ["reset", "approvedExecute"],
    ["connectionLost", "preflight"],
    ["connectionLost", "approvedExecute"],
  ] as const)(
    "ignores an old %s/%s result even if a fresh call reuses the identity",
    async (reset, phase) => {
      const { host, browser, send, approve, response, bind, connection } =
        setup();
      const old = deferred<BrowserToolResult>();
      const fresh = deferred<BrowserToolResult>();
      if (phase === "approvedExecute") {
        browser.executeTool.mockResolvedValueOnce(approval("initial-token"));
        await send();
      }
      browser.executeTool
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(fresh.promise);
      const oldRunning =
        phase === "preflight" ? send() : approve("initial-token");
      host[reset]();
      bind();
      const freshRunning = send();
      old.resolve(approval("old-token"));
      await oldRunning;
      expect(response()?.approval).toBeUndefined();
      await approve("old-token");
      fresh.resolve(approval("fresh-token"));
      await freshRunning;
      expect(response()?.approval?.approvalToken).toBe("fresh-token");
      await approve("old-token");
      await approve("fresh-token");
      expect(response()?.success).toBe(true);
      expect(browser.executeTool).toHaveBeenCalledTimes(
        phase === "preflight" ? 3 : 4,
      );
      expect(connection.rejectServerRequest).toHaveBeenCalledTimes(2);
    },
  );

  it("does not let a failure from before reset consume a fresh pending approval", async () => {
    const { host, browser, send, approve, response, bind } = setup();
    const old = deferred<BrowserToolResult>();
    browser.executeTool.mockReturnValueOnce(old.promise);
    const oldRunning = send();
    host.reset();
    bind();
    browser.executeTool.mockResolvedValueOnce(approval("fresh-token"));
    await send();
    old.reject(new Error("old request disconnected"));
    await oldRunning;
    await approve("fresh-token");
    expect(response()?.success).toBe(true);
    expect(browser.executeTool).toHaveBeenCalledTimes(3);
  });

  it.each(["", "   ", 5, {}])(
    "rejects a present preflight token %j before execution",
    async (token) => {
      const { browser, send, connection } = setup();
      await send({ approvalToken: token });
      expect(browser.executeTool).not.toHaveBeenCalled();
      expect(connection.rejectServerRequest).toHaveBeenCalledWith(
        "request-1",
        expect.objectContaining({
          message: expect.stringContaining("approvalToken must be absent"),
        }),
      );
    },
  );

  it.each([{ namespace: "browser " }, { tool: "click " }])(
    "does not normalize a changed frozen binding %j",
    async (changed) => {
      const { browser, send, approve, connection } = setup();
      browser.executeTool.mockResolvedValueOnce(approval("token-1"));
      await send();
      await approve("token-1", changed);
      expect(browser.executeTool).toHaveBeenCalledTimes(1);
      expect(connection.rejectServerRequest).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["", "   ", undefined])(
    "fails malformed Browser approval token %j without leaving a reusable call",
    async (token) => {
      const { browser, send, approve, response, connection } = setup();
      const invalid = approval("placeholder");
      invalid.approval!.approvalToken = token as string;
      browser.executeTool.mockResolvedValueOnce(invalid);
      await send();
      expect(response()?.success).toBe(false);
      expect(response()?.approval).toBeUndefined();
      await approve("placeholder");
      expect(connection.rejectServerRequest).toHaveBeenCalledTimes(1);
      expect(browser.executeTool).toHaveBeenCalledTimes(1);
    },
  );
});
