import { act } from "react";
import { createRoot } from "react-dom/client";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const unmounts: (() => void)[] = [];
function cleanup() { unmounts.splice(0).forEach((unmount) => unmount()); }
function renderHook<T>(useHook: () => T) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const result = {} as { current: T };
  function Harness() { result.current = useHook(); return null; }
  act(() => root.render(<Harness />));
  unmounts.push(() => { act(() => root.unmount()); container.remove(); });
  return { result };
}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { changeLimeLocale } from "@/i18n/createI18n";
import { acceptedSubmission } from "../hooks/agentSendResult.testFixtures";
import type { RuntimeSubmissionResult } from "../hooks/agentSendResult";
import { useWorkspaceSendActions } from "./useWorkspaceSendActions";

type HookProps = Parameters<typeof useWorkspaceSendActions>[0];
const sendMessage = vi.fn<HookProps["sendMessage"]>();
const setInput = vi.fn();
const finalize = vi.fn();
const rollback = vi.fn();
const ensureSession = vi.fn(async () => null);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function mount(props: Partial<HookProps> = {}) {
  return renderHook(() =>
    useWorkspaceSendActions({
      input: "请打开浏览器",
      setInput,
      mentionedCharacters: [],
      setMentionedCharacters: vi.fn(),
      chatToolPreferences: { task: false, subagent: false },
      mappedTheme: "general",
      isThemeWorkbench: false,
      projectId: null,
      sessionId: null,
      executionStrategy: "react",
      currentGateKey: "default_gate",
      messages: [],
      sendMessage,
      resolveSendBoundary: ({ sourceText }) => ({
        sourceText,
        browserRequirementMatch: null,
        shouldConsumePendingGeneralWorkbenchInitialPrompt: false,
        shouldDismissGeneralWorkbenchEntryPrompt: false,
      }),
      finalizeAfterSendSuccess: finalize,
      rollbackAfterSendFailure: rollback,
      ensureSessionForCommandMetadata: ensureSession,
      ...props,
    }),
  );
}
beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(toast, "error").mockImplementation(() => "error-toast");
  sendMessage.mockResolvedValue(acceptedSubmission());
  await changeLimeLocale("zh-CN");
});
afterEach(cleanup);

describe("同一 runtime 发送主链", () => {
  it.each([
    "普通消息",
    "@翻译 把这句话翻译成英文",
    "@配图 画一只猫",
    "画一张海报",
    "@浏览器 打开百度新闻",
    'Download and install a skill.\nSKILL_NAME="fixture-skill"\nDOWNLOAD_URL="https://example.com/skill.zip"',
  ])(
    "普通输入原样交给 runtime，不合成专用任务或本地回复：%s",
    async (input) => {
      const h = mount({ input });
      await act(async () => {
        expect((await h.result.current.handleSend()).kind).toBe(
          "runtime-accepted",
        );
      });
      expect(sendMessage).toHaveBeenCalledOnce();
      expect(sendMessage.mock.calls[0][0]).toBe(input);
      const options = sendMessage.mock.calls[0][8];
      expect(options?.assistantDraft).toBeUndefined();
      expect(options?.systemPromptOverride).toBeUndefined();
      expect(options?.providerOverride).toBeUndefined();
      expect(options?.modelOverride).toBeUndefined();
      expect(JSON.stringify(options?.requestMetadata)).not.toMatch(
        /skill_launch|image_command_intent|publish_command/,
      );
      expect(ensureSession).not.toHaveBeenCalled();
      expect(finalize).toHaveBeenCalledOnce();
      expect(h.result.current.displayMessages).toEqual([]);
    },
  );

  it("空输入不创建会话或提交回合", async () => {
    const h = mount({ input: "  " });
    await act(async () => {
      expect((await h.result.current.handleSend()).kind).toBe("rejected");
    });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(ensureSession).not.toHaveBeenCalled();
    expect(h.result.current.isPreparingSend).toBe(false);
  });

  it("图片附件经过同一回合，不直建图片任务", async () => {
    const image = {
      data: "data:image/png;base64,aGVsbG8=",
      mediaType: "image/png",
    };
    const h = mount({ input: "" });
    await act(async () => {
      await h.result.current.handleSend([image]);
    });
    expect(sendMessage.mock.calls[0][1]).toEqual([image]);
  });

  it("用户显式选择的模型与 Provider 保留在提交选项", async () => {
    const h = mount();
    await act(async () => {
      await h.result.current.handleSend(
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          providerOverride: "backup-provider",
          modelOverride: "gpt-6.1-sol",
        },
      );
    });
    expect(sendMessage.mock.calls[0][8]).toMatchObject({
      providerOverride: "backup-provider",
      modelOverride: "gpt-6.1-sol",
    });
  });

  it("首轮不等待非必要配置预加载", async () => {
    const resolveServiceModelsBeforeSend = vi.fn(
      () => new Promise<never>(() => {}),
    );
    const h = mount({ resolveServiceModelsBeforeSend });
    await act(async () => {
      await h.result.current.handleSend();
    });
    expect(resolveServiceModelsBeforeSend).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it("保留多模型 fast slot，不在 renderer 擅自覆盖模型", async () => {
    const h = mount({
      serviceModels: {
        responsive_chat: {
          enabled: true,
          preferredProviderId: "provider-fast",
          preferredModelId: "model-fast",
        },
      },
    });
    await act(async () => {
      await h.result.current.handleSend();
    });
    expect(sendMessage.mock.calls[0][8]).toMatchObject({
      requestMetadata: {
        harness: {
          model_slots: {
            fast: expect.objectContaining({
              provider: "provider-fast",
              model: "model-fast",
            }),
          },
        },
      },
    });
    expect(sendMessage.mock.calls[0][8]?.modelOverride).toBeUndefined();
  });

  it("保留工作区 metadata、响应语言与 canonical 权限边界", async () => {
    const h = mount({
      accessMode: "full-access",
      agentResponseLanguage: "ja-JP",
      workspaceRequestMetadataBase: {
        workspace_marker: "keep",
        harness: { custom: true },
      },
    });
    await act(async () => {
      await h.result.current.handleSend();
    });
    const metadata = sendMessage.mock.calls[0][8]?.requestMetadata;
    expect(metadata).toMatchObject({
      workspace_marker: "keep",
      harness: { custom: true },
    });
    expect(JSON.stringify(metadata)).not.toContain('"access_mode"');
  });

  it("提交等待期间拒绝重复发送，结束后解除锁定", async () => {
    const pending = deferred<RuntimeSubmissionResult>();
    sendMessage.mockReturnValueOnce(pending.promise);
    const h = mount();
    let first!: Promise<RuntimeSubmissionResult>;
    await act(async () => {
      first = h.result.current.handleSend();
    });
    expect(h.result.current.isPreparingSend).toBe(true);
    await act(async () => {
      expect((await h.result.current.handleSend()).kind).toBe("rejected");
    });
    expect(sendMessage).toHaveBeenCalledOnce();
    await act(async () => {
      pending.resolve(acceptedSubmission());
      await first;
    });
    expect(h.result.current.isPreparingSend).toBe(false);
    expect(finalize).toHaveBeenCalledOnce();
  });

  it("拒绝时恢复输入且不执行成功收尾", async () => {
    const error = new Error("HTTP 503 Service Unavailable");
    sendMessage.mockRejectedValueOnce(error);
    const h = mount();
    await act(async () => {
      expect(await h.result.current.handleSend()).toEqual({
        kind: "rejected",
        error,
      });
    });
    expect(rollback).toHaveBeenCalledOnce();
    expect(finalize).not.toHaveBeenCalled();
    expect(setInput).toHaveBeenLastCalledWith("请打开浏览器");
    expect(toast.error).toHaveBeenCalled();
    expect(h.result.current.displayMessages).toEqual([]);
    expect(h.result.current.isPreparingSend).toBe(false);
  });

  it("准备失败清理预览与锁定，允许用户再次提交", async () => {
    const resolveSendBoundary = vi.fn().mockImplementationOnce(() => {
      throw new Error("boundary failed");
    });
    const h = mount({ resolveSendBoundary });
    await act(async () => {
      await expect(h.result.current.handleSend()).rejects.toThrow(
        "boundary failed",
      );
    });
    expect(h.result.current.isPreparingSend).toBe(false);
    expect(h.result.current.displayMessages).toEqual([]);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
