import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./agentStreamUserInputSendPreparation", () => ({
  prepareAgentStreamUserInputSend: vi.fn(),
}));

vi.mock("./agentStreamPreparedSendDispatch", () => ({
  dispatchPreparedAgentStreamSend: vi.fn(),
}));

import { dispatchPreparedAgentStreamSend } from "./agentStreamPreparedSendDispatch";
import { prepareAgentStreamUserInputSend } from "./agentStreamUserInputSendPreparation";
import { sendAgentStreamMessage } from "./agentStreamSend";

describe("sendAgentStreamMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createEnv = (overrides?: Record<string, unknown>) =>
    ({
      sessionIdRef: { current: "session-existing" },
      reasoningEffortRef: { current: "" },
      ensureSession: vi.fn(async () => "session-existing"),
      waitForSessionProviderSelectionSync: vi.fn(async () => undefined),
      ...overrides,
    }) as never;

  it.each([
    { selected: "low", override: undefined, expected: "low" },
    { selected: "", override: undefined, expected: undefined },
    { selected: "low", override: "high", expected: "high" },
  ])(
    "首发创建回读默认档位后仍保留本次选择 $selected/$override",
    async ({ selected, override, expected }) => {
      const reasoningEffortRef = { current: selected };
      const sessionIdRef = { current: null as string | null };
      const env = createEnv({
        sessionIdRef,
        reasoningEffortRef,
        ensureSession: vi.fn(async () => {
          reasoningEffortRef.current = "ultra";
          sessionIdRef.current = "session-created";
          return "session-created";
        }),
      });
      await sendAgentStreamMessage({
        content: "首发档位",
        images: [],
        options: override ? { reasoningEffort: override } : undefined,
        env,
      });
      expect(
        vi.mocked(prepareAgentStreamUserInputSend).mock.calls[0][0].options
          ?.reasoningEffort,
      ).toBe(expected);
    },
  );

  it("恢复指定会话时不携带无会话输入框的档位", async () => {
    await sendAgentStreamMessage({
      content: "恢复会话",
      images: [],
      options: { targetSessionId: "target-session" },
      env: createEnv({
        sessionIdRef: { current: null },
        reasoningEffortRef: { current: "low" },
      }),
    });
    expect(
      vi.mocked(prepareAgentStreamUserInputSend).mock.calls[0][0].options,
    ).toEqual({ targetSessionId: "target-session" });
  });

  it("真实 ensureSession 返回后、模型同步和乐观准备前移交创建身份", async () => {
    const order: string[] = [];
    const onSessionReady = vi.fn((sessionId: string) => order.push(sessionId));
    const env = createEnv({
      sessionIdRef: { current: null },
      ensureSession: vi.fn(async () => {
        order.push("create");
        return "session-created";
      }),
      waitForSessionProviderSelectionSync: vi.fn(async () => {
        order.push("model-sync");
      }),
    });
    vi.mocked(prepareAgentStreamUserInputSend).mockImplementation(() => {
      order.push("prepare");
      return {} as never;
    });
    await sendAgentStreamMessage({
      content: "/goal 目标",
      images: [],
      options: { observer: { onSessionReady } },
      env,
    });
    expect(order).toEqual([
      "create",
      "session-created",
      "model-sync",
      "prepare",
    ]);
    expect(onSessionReady).toHaveBeenCalledOnce();
  });

  it("会话身份 observer 异常不阻断真实发送", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      await sendAgentStreamMessage({
        content: "继续",
        images: [],
        env: createEnv(),
        options: {
          observer: {
            onSessionReady: () => {
              throw new Error("observer failed");
            },
          },
        },
      });
      expect(dispatchPreparedAgentStreamSend).toHaveBeenCalledOnce();
      expect(error).toHaveBeenCalledWith(
        "[AgentStream] session readiness observer failed",
      );
    } finally {
      error.mockRestore();
    }
  });

  it("应串起 prepare 与 dispatch", async () => {
    const env = createEnv();
    const preparedSend = { prepared: true };
    vi.mocked(prepareAgentStreamUserInputSend).mockReturnValue(
      preparedSend as never,
    );

    const receipt = {
      kind: "start" as const,
      sessionId: "session-existing",
      threadId: "thread-1",
      turnId: "turn-1",
    };
    vi.mocked(dispatchPreparedAgentStreamSend).mockResolvedValue(receipt);
    const result = await sendAgentStreamMessage({
      content: "继续执行",
      images: [],
      webSearch: true,
      thinking: true,
      executionStrategyOverride: "react",
      modelOverride: "gpt-5.4",
      systemPrompt: "system",
      env,
    });

    expect(result).toBe(receipt);
    expect(prepareAgentStreamUserInputSend).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "继续执行",
        webSearch: true,
        thinking: true,
        systemPrompt: "system",
        env,
      }),
    );
    expect(dispatchPreparedAgentStreamSend).toHaveBeenCalledWith({
      preparedSend,
      env,
    });
  });

  it("空态首发应先创建会话再准备乐观消息", async () => {
    const order: string[] = [];
    const sessionIdRef = { current: null as string | null };
    const ensureSession = vi.fn(async () => {
      order.push("ensureSession");
      sessionIdRef.current = "session-created";
      return "session-created";
    });
    const env = createEnv({
      sessionIdRef,
      ensureSession,
    });
    const preparedSend = { prepared: true };
    vi.mocked(prepareAgentStreamUserInputSend).mockImplementation(() => {
      order.push("prepare");
      return preparedSend as never;
    });

    await sendAgentStreamMessage({
      content: "第一条消息",
      images: [],
      env,
    });

    expect(order).toEqual(["ensureSession", "prepare"]);
    expect(ensureSession).toHaveBeenCalledWith({
      targetSessionId: undefined,
      skipSessionRestore: false,
      skipSessionStartHooks: false,
    });
    expect(prepareAgentStreamUserInputSend).toHaveBeenCalledWith(
      expect.objectContaining({ env }),
    );
    expect(dispatchPreparedAgentStreamSend).toHaveBeenCalledWith({
      preparedSend,
      env,
    });
  });

  it("目标会话首发应先绑定 session 再准备乐观消息", async () => {
    const order: string[] = [];
    const sessionIdRef = { current: null as string | null };
    const ensureSession = vi.fn(
      async (options?: { targetSessionId?: string }) => {
        order.push("ensureSession");
        sessionIdRef.current = options?.targetSessionId ?? null;
        return sessionIdRef.current;
      },
    );
    const env = createEnv({
      sessionIdRef,
      ensureSession,
    });
    const preparedSend = { prepared: true };
    vi.mocked(prepareAgentStreamUserInputSend).mockImplementation(() => {
      order.push(`prepare:${sessionIdRef.current ?? "none"}`);
      return preparedSend as never;
    });

    await sendAgentStreamMessage({
      content: "你好",
      images: [],
      options: {
        targetSessionId: "session-materialized",
        skipSessionRestore: true,
        skipSessionStartHooks: true,
      },
      env,
    });

    expect(order).toEqual(["ensureSession", "prepare:session-materialized"]);
    expect(ensureSession).toHaveBeenCalledWith({
      targetSessionId: "session-materialized",
      skipSessionRestore: true,
      skipSessionStartHooks: true,
    });
    expect(dispatchPreparedAgentStreamSend).toHaveBeenCalledWith({
      preparedSend,
      env,
    });
  });

  it("应等待目标会话模型选择同步后再准备发送", async () => {
    const order: string[] = [];
    let releaseSelectionSync: (() => void) | undefined;
    const selectionSync = new Promise<void>((resolve) => {
      releaseSelectionSync = resolve;
    });
    const waitForSessionProviderSelectionSync = vi.fn(
      async (sessionId: string) => {
        order.push(`wait:${sessionId}`);
        await selectionSync;
      },
    );
    const env = createEnv({ waitForSessionProviderSelectionSync });
    const preparedSend = { prepared: true };
    vi.mocked(prepareAgentStreamUserInputSend).mockImplementation(() => {
      order.push("prepare");
      return preparedSend as never;
    });

    const send = sendAgentStreamMessage({
      content: "使用刚选择的模型",
      images: [],
      env,
    });
    await Promise.resolve();

    expect(order).toEqual(["wait:session-existing"]);
    expect(prepareAgentStreamUserInputSend).not.toHaveBeenCalled();

    releaseSelectionSync?.();
    await send;

    expect(order).toEqual(["wait:session-existing", "prepare"]);
    expect(dispatchPreparedAgentStreamSend).toHaveBeenCalledWith({
      preparedSend,
      env,
    });
  });
});
