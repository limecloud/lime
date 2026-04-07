import { act, useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupMountedRoots,
  flushEffects,
  renderIntoDom,
  setReactActEnvironment,
  type MountedRoot,
} from "./test-utils";

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
        type: "fal",
        name: "Fal",
        enabled: true,
        api_key_count: 1,
        api_host: "https://fal.run",
      },
    ],
    loading: false,
  }),
}));

import { useImageGen } from "./useImageGen";

interface HookHarness {
  getValue: () => ReturnType<typeof useImageGen>;
}

const mountedRoots: MountedRoot[] = [];

function mountHook(preferredProviderId?: string): HookHarness {
  let hookValue: ReturnType<typeof useImageGen> | null = null;

  function TestComponent() {
    hookValue = useImageGen({ preferredProviderId });
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

function mountHookWithOptions(options: {
  preferredProviderId?: string;
  preferredModelId?: string;
  allowFallback?: boolean;
}): HookHarness {
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

function mountHookWithReactiveOptions(initialOptions: {
  preferredProviderId?: string;
  preferredModelId?: string;
  allowFallback?: boolean;
}): HookHarness & {
  updateOptions: (next: {
    preferredProviderId?: string;
    preferredModelId?: string;
    allowFallback?: boolean;
  }) => Promise<void>;
} {
  let hookValue: ReturnType<typeof useImageGen> | null = null;
  let setOptions:
    | ((next: {
        preferredProviderId?: string;
        preferredModelId?: string;
        allowFallback?: boolean;
      }) => void)
    | null = null;

  function TestComponent() {
    const [options, setInnerOptions] = useState(initialOptions);
    useEffect(() => {
      setOptions = setInnerOptions;
    }, []);
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
    updateOptions: async (next) => {
      await act(async () => {
        setOptions?.(next);
        await Promise.resolve();
      });
    },
  };
}

async function waitForReady(harness: HookHarness, timeout = 40): Promise<void> {
  for (let i = 0; i < timeout; i += 1) {
    const value = harness.getValue();
    if (value.selectedProvider && value.selectedModelId) {
      return;
    }
    await flushEffects();
  }
  throw new Error("useImageGen 未在预期时间内就绪");
}

beforeEach(() => {
  setReactActEnvironment();
});

afterEach(() => {
  cleanupMountedRoots(mountedRoots);
  vi.restoreAllMocks();
});

describe("useImageGen 项目偏好", () => {
  it("应优先选择项目指定的图片 Provider 和模型", async () => {
    const harness = mountHook("fal");
    await act(async () => {
      await waitForReady(harness);
    });

    expect(harness.getValue().selectedProvider?.id).toBe("fal");
    expect(harness.getValue().selectedModelId).toBe("fal-ai/nano-banana-pro");
  });

  it("应优先选择项目指定的图片模型", async () => {
    const harness = mountHookWithOptions({
      preferredProviderId: "fal",
      preferredModelId: "fal-ai/flux-kontext/dev",
    });
    await act(async () => {
      await waitForReady(harness);
    });

    expect(harness.getValue().selectedProvider?.id).toBe("fal");
    expect(harness.getValue().selectedModelId).toBe("fal-ai/flux-kontext/dev");
  });

  it("偏好在首次挂载后到达时，也应切换到设置指定的图片 Provider 和模型", async () => {
    const harness = mountHookWithReactiveOptions({});
    await act(async () => {
      await waitForReady(harness);
    });

    expect(harness.getValue().selectedProvider?.id).toBe("zhipuai");

    await harness.updateOptions({
      preferredProviderId: "fal",
      preferredModelId: "fal-ai/flux-kontext/dev",
    });

    await act(async () => {
      await waitForReady(harness);
    });

    expect(harness.getValue().selectedProvider?.id).toBe("fal");
    expect(harness.getValue().selectedModelId).toBe("fal-ai/flux-kontext/dev");
  });

  it("默认图片服务不可用且禁止回退时，不应偷偷切到其他 Provider", async () => {
    const harness = mountHookWithOptions({
      preferredProviderId: "missing-provider",
      allowFallback: false,
    });
    await act(async () => {
      await flushEffects();
    });

    expect(harness.getValue().selectedProvider).toBeUndefined();
    expect(harness.getValue().selectedProviderId).toBe("");
    expect(harness.getValue().preferredProviderUnavailable).toBe(true);
  });
});
