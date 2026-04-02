import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InputbarVisionCapabilityNotice } from "./InputbarVisionCapabilityNotice";

const mockUseConfiguredProviders = vi.fn();
const mockUseProviderModels = vi.fn();
const mockResolveVisionModel = vi.fn();

vi.mock("@/hooks/useConfiguredProviders", () => ({
  useConfiguredProviders: (options: unknown) => mockUseConfiguredProviders(options),
}));

vi.mock("@/hooks/useProviderModels", () => ({
  useProviderModels: (...args: unknown[]) => mockUseProviderModels(...args),
}));

vi.mock("@/lib/model/visionModelResolver", () => ({
  resolveVisionModel: (...args: unknown[]) => mockResolveVisionModel(...args),
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  mockUseConfiguredProviders.mockReturnValue({
    providers: [
      {
        key: "openai",
        label: "OpenAI",
        registryId: "openai",
        type: "openai",
        providerId: "openai",
        apiHost: "https://api.openai.com/v1",
      },
    ],
    loading: false,
  });
  mockUseProviderModels.mockReturnValue({
    models: [{ id: "gpt-4.1" }, { id: "gpt-4.1-vision" }],
    loading: false,
    error: null,
    modelIds: ["gpt-4.1", "gpt-4.1-vision"],
  });
  mockResolveVisionModel.mockReturnValue({
    reason: "already_vision",
    targetModelId: "gpt-4.1",
  });
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) break;
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  vi.clearAllMocks();
});

function renderNotice(
  props?: Partial<React.ComponentProps<typeof InputbarVisionCapabilityNotice>>,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <InputbarVisionCapabilityNotice
        hasPendingImages
        providerType="openai"
        model="gpt-4.1"
        {...props}
      />,
    );
  });

  mountedRoots.push({ root, container });
  return container;
}

describe("InputbarVisionCapabilityNotice", () => {
  it("受管 API Key Provider 应按真实模型目录检查多模态能力", () => {
    renderNotice();

    expect(mockUseProviderModels).toHaveBeenCalledWith(
      expect.objectContaining({ key: "openai" }),
      expect.objectContaining({
        returnFullMetadata: true,
        autoLoad: true,
        liveFetchOnly: true,
        hasApiKey: true,
      }),
    );
  });

  it("当前模型支持多模态时不应展示提示", () => {
    const container = renderNotice();

    expect(
      container.querySelector('[data-testid="inputbar-vision-warning"]'),
    ).toBeNull();
  });

  it("当前模型不支持多模态时应展示推荐模型提示", () => {
    mockResolveVisionModel.mockReturnValue({
      reason: "switched",
      targetModelId: "gpt-4.1-vision",
    });

    const container = renderNotice();

    expect(container.textContent).toContain("gpt-4.1 不支持多模态图片理解");
    expect(container.textContent).toContain("gpt-4.1-vision");
  });

  it("当前 Provider 没有可用多模态模型时应展示 Provider 级提示", () => {
    mockResolveVisionModel.mockReturnValue({
      reason: "no_vision_model",
      targetModelId: "",
    });

    const container = renderNotice();

    expect(container.textContent).toContain("当前 Provider 暂无可用的多模态模型");
  });
});
