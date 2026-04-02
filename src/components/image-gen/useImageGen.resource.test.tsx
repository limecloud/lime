import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupMountedRoots,
  flushEffects,
  renderIntoDom,
  setReactActEnvironment,
  silenceConsole,
  waitForCondition,
  type MountedRoot,
} from "./test-utils";

const { mockGetNextApiKey, mockInvoke } = vi.hoisted(() => ({
  mockGetNextApiKey: vi.fn(),
  mockInvoke: vi.fn(),
}));

vi.mock("@/hooks/useApiKeyProvider", () => ({
  useApiKeyProvider: () => ({
    providers: [
      {
        id: "zhipuai",
        type: "zhipuai",
        name: "智谱AI",
        enabled: true,
        api_key_count: 1,
        api_host: "https://api.zhipu.test",
      },
      {
        id: "fal",
        type: "openai",
        name: "Fal",
        enabled: true,
        api_key_count: 1,
        api_host: "https://fal.run/fal-ai",
        custom_models: ["gpt-5.2-pro"],
      },
    ],
    loading: false,
  }),
}));

vi.mock("@/lib/api/apiKeyProvider", () => ({
  apiKeyProviderApi: {
    getNextApiKey: mockGetNextApiKey,
  },
}));

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: mockInvoke,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

import {
  IMAGE_GENERATION_CANCELED_MESSAGE,
  useImageGen,
} from "./useImageGen";
import type { GeneratedImage } from "./types";

interface HookHarness {
  getValue: () => ReturnType<typeof useImageGen>;
}

const mountedRoots: MountedRoot[] = [];

function mountHook(): HookHarness {
  return mountHookWithOptions();
}

function mountHookWithOptions(options: {
  preferredProviderId?: string;
  preferredModelId?: string;
  allowFallback?: boolean;
} = {}): HookHarness {
  let hookValue: ReturnType<typeof useImageGen> | null = null;

  function TestComponent() {
    hookValue = useImageGen(options);
    return null;
  }

  renderIntoDom(<TestComponent />, mountedRoots);

  return {
    getValue: () => {
      if (!hookValue) {
        throw new Error("hook 尚未初始化");
      }
      return hookValue;
    },
  };
}

async function waitForReady(
  harness: HookHarness,
  timeout = 40,
): Promise<void> {
  for (let i = 0; i < timeout; i += 1) {
    const value = harness.getValue();
    if (value.selectedProvider && value.selectedModelId) {
      return;
    }
    await flushEffects();
  }
  throw new Error("useImageGen 未在预期时间内就绪");
}

function createSuccessResponse() {
  return new Response(
    JSON.stringify({
      data: [{ url: "https://cdn.example.com/generated.png" }],
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

function createTextResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}

function createAbortableFetchDeferred() {
  let resolveResponse: ((response: Response) => void) | null = null;
  let rejectResponse: ((reason?: unknown) => void) | null = null;

  const responsePromise = new Promise<Response>((resolve, reject) => {
    resolveResponse = resolve;
    rejectResponse = reject;
  });

  const fetchMock = vi.fn().mockImplementation(
    (_input: string, init?: globalThis.RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const signal = init?.signal;
        const handleAbort = () => {
          reject(
            signal?.reason ??
              new DOMException(
                IMAGE_GENERATION_CANCELED_MESSAGE,
                "AbortError",
              ),
          );
        };

        signal?.addEventListener("abort", handleAbort, { once: true });
        responsePromise.then(
          (response) => {
            signal?.removeEventListener("abort", handleAbort);
            resolve(response);
          },
          (error) => {
            signal?.removeEventListener("abort", handleAbort);
            reject(error);
          },
        );
      }),
  );

  return {
    fetchMock,
    resolve(response: Response) {
      resolveResponse?.(response);
    },
    reject(reason?: unknown) {
      rejectResponse?.(reason);
    },
  };
}

beforeEach(() => {
  setReactActEnvironment();

  localStorage.clear();
  vi.clearAllMocks();
  silenceConsole();
  mockGetNextApiKey.mockResolvedValue("test-api-key");
  mockInvoke.mockResolvedValue({ id: "material-1" });

  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(createSuccessResponse()) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanupMountedRoots(mountedRoots);

  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("useImageGen 资源入库", () => {
  it("generateImage 返回时应直接提供可消费的完成结果", async () => {
    const harness = mountHook();
    await waitForReady(harness);

    let result: Awaited<ReturnType<ReturnType<typeof useImageGen>["generateImage"]>> =
      [];

    await act(async () => {
      result = await harness.getValue().generateImage("生成一张立即可用的测试图");
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      status: "complete",
      url: "https://cdn.example.com/generated.png",
      prompt: "生成一张立即可用的测试图",
    });
  });

  it("自动入库成功时应回写素材字段", async () => {
    const harness = mountHook();
    await waitForReady(harness);

    await act(async () => {
      await harness.getValue().generateImage("生成一张测试图", {
        targetProjectId: "project-1",
      });
    });

    const completed = harness
      .getValue()
      .images.find((image) => image.status === "complete");

    expect(completed).toBeDefined();
    expect(completed?.resourceMaterialId).toBe("material-1");
    expect(completed?.resourceProjectId).toBe("project-1");
    expect(typeof completed?.resourceSavedAt).toBe("number");
    expect(completed?.resourceSaveError).toBeUndefined();

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith(
      "import_material_from_url",
      expect.objectContaining({
        req: expect.objectContaining({
          projectId: "project-1",
          type: "image",
          url: "https://cdn.example.com/generated.png",
        }),
      }),
    );
  });

  it("自动入库失败时应保留图片并写入错误信息", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("resource save failed"));
    const harness = mountHook();
    await waitForReady(harness);

    await act(async () => {
      await harness.getValue().generateImage("生成一张失败回写图", {
        targetProjectId: "project-1",
      });
    });

    const completed = harness
      .getValue()
      .images.find((image) => image.status === "complete");

    expect(completed).toBeDefined();
    expect(completed?.resourceMaterialId).toBeUndefined();
    expect(completed?.resourceProjectId).toBeUndefined();
    expect(completed?.resourceSaveError).toBe("resource save failed");
  });

  it("Fal 全失败时应抛出详细错误而不是静默返回空结果", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createTextResponse("sync primary failed", 500))
      .mockResolvedValueOnce(createTextResponse("queue submit failed", 500));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const harness = mountHookWithOptions({
      preferredProviderId: "fal",
      preferredModelId: "fal-ai/nano-banana-pro",
    });
    await waitForReady(harness);

    let thrownError: unknown = null;

    await act(async () => {
      try {
        await harness.getValue().generateImage("生成一张失败测试图");
      } catch (error) {
        thrownError = error;
      }
    });

    expect(thrownError).toBeInstanceOf(Error);
    expect((thrownError as Error).message).toContain("Fal 图片生成失败");
    expect((thrownError as Error).message).toContain("sync-primary");
    expect((thrownError as Error).message).toContain("queue");

    const failed = harness
      .getValue()
      .images.find((image) => image.status === "error");

    expect(failed).toBeDefined();
    expect(failed?.error).toContain("Fal 图片生成失败");
  });

  it("Fal 历史配置混入文本模型时，应自动切回有效图片模型", async () => {
    const harness = mountHookWithOptions({
      preferredProviderId: "fal",
      preferredModelId: "gpt-5.2-pro",
    });
    await waitForReady(harness);

    expect(harness.getValue().selectedProvider?.id).toBe("fal");
    expect(harness.getValue().selectedModelId).toBe("fal-ai/nano-banana-pro");
  });

  it("取消生成时应立即退出 generating，并阻止旧结果回写", async () => {
    const deferred = createAbortableFetchDeferred();
    vi.stubGlobal("fetch", deferred.fetchMock as unknown as typeof fetch);

    const harness = mountHook();
    await waitForReady(harness);

    let generationPromise!: Promise<GeneratedImage[] | null>;
    let thrownError: unknown = null;
    await act(async () => {
      generationPromise = harness
        .getValue()
        .generateImage("生成一张可取消的测试图")
        .catch((error) => {
          thrownError = error;
          return null;
        });
      await Promise.resolve();
    });

    await waitForCondition(
      () =>
        harness.getValue().generating &&
        harness
          .getValue()
          .images.some((image) => image.status === "generating"),
      40,
      "图片任务未进入 generating 状态",
    );

    await act(async () => {
      harness.getValue().cancelGeneration();
      await Promise.resolve();
    });

    await act(async () => {
      await generationPromise;
    });

    expect(thrownError).toBeInstanceOf(Error);
    expect((thrownError as Error).message).toBe(
      IMAGE_GENERATION_CANCELED_MESSAGE,
    );
    expect(harness.getValue().generating).toBe(false);

    const canceledImage = harness
      .getValue()
      .images.find((image) => image.prompt === "生成一张可取消的测试图");

    expect(canceledImage).toBeDefined();
    expect(canceledImage?.status).toBe("error");
    expect(canceledImage?.error).toBe(IMAGE_GENERATION_CANCELED_MESSAGE);
    expect(canceledImage?.url).toBe("");

    deferred.resolve(createSuccessResponse());
    await flushEffects();

    const afterResolve = harness
      .getValue()
      .images.find((image) => image.id === canceledImage?.id);

    expect(afterResolve?.status).toBe("error");
    expect(afterResolve?.error).toBe(IMAGE_GENERATION_CANCELED_MESSAGE);
    expect(afterResolve?.url).toBe("");
  });
});
