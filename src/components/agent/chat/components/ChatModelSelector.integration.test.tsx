import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockInitAsterAgent,
  mockCreateAgentRuntimeSession,
  mockListAgentRuntimeSessions,
  mockGetAgentRuntimeSession,
  mockUpdateAgentRuntimeSession,
  mockParseAgentEvent,
  mockSafeListen,
  mockToast,
  mockUseConfiguredProviders,
  mockUseProviderModels,
  mockProviderPoolGetOverview,
  mockApiKeyProvidersGetProviders,
  mockEmitProviderDataChanged,
  mockWechatChannelSetRuntimeModel,
} = vi.hoisted(() => ({
  mockInitAsterAgent: vi.fn(),
  mockCreateAgentRuntimeSession: vi.fn(),
  mockListAgentRuntimeSessions: vi.fn(),
  mockGetAgentRuntimeSession: vi.fn(),
  mockUpdateAgentRuntimeSession: vi.fn(),
  mockParseAgentEvent: vi.fn((payload: unknown) => payload),
  mockSafeListen: vi.fn(),
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
  mockUseConfiguredProviders: vi.fn(),
  mockUseProviderModels: vi.fn(),
  mockProviderPoolGetOverview: vi.fn(),
  mockApiKeyProvidersGetProviders: vi.fn(),
  mockEmitProviderDataChanged: vi.fn(),
  mockWechatChannelSetRuntimeModel: vi.fn(async () => undefined),
}));

vi.mock("@/lib/api/agentRuntime", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/agentRuntime")>(
    "@/lib/api/agentRuntime",
  );

  return {
    ...actual,
    initAsterAgent: mockInitAsterAgent,
    createAgentRuntimeSession: mockCreateAgentRuntimeSession,
    listAgentRuntimeSessions: mockListAgentRuntimeSessions,
    getAgentRuntimeSession: mockGetAgentRuntimeSession,
    updateAgentRuntimeSession: mockUpdateAgentRuntimeSession,
  };
});

vi.mock("@/lib/api/agentProtocol", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/api/agentProtocol")
  >("@/lib/api/agentProtocol");
  return {
    ...actual,
    parseAgentEvent: mockParseAgentEvent,
  };
});

vi.mock("@/lib/dev-bridge", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/dev-bridge")>(
      "@/lib/dev-bridge",
    );

  return {
    ...actual,
    safeListen: mockSafeListen,
  };
});

vi.mock("sonner", () => ({
  toast: mockToast,
}));

vi.mock("@/hooks/useConfiguredProviders", () => ({
  useConfiguredProviders: mockUseConfiguredProviders,
  findConfiguredProviderBySelection: (
    providers: Array<{ key: string; providerId?: string }>,
    selection?: string | null,
  ) => {
    const normalizedSelection = (selection || "").trim().toLowerCase();
    const keyMatch =
      providers.find(
        (provider) => provider.key.trim().toLowerCase() === normalizedSelection,
      ) ?? null;
    const providerIdMatch =
      providers.find(
        (provider) =>
          (provider.providerId || "").trim().toLowerCase() ===
          normalizedSelection,
      ) ?? null;

    if (keyMatch && providerIdMatch && keyMatch !== providerIdMatch) {
      if (!keyMatch.providerId && providerIdMatch.providerId) {
        return providerIdMatch;
      }
    }

    return keyMatch ?? providerIdMatch ?? null;
  },
}));

vi.mock("@/hooks/useProviderModels", () => ({
  useProviderModels: mockUseProviderModels,
}));

vi.mock("@/lib/api/providerPool", () => ({
  providerPoolApi: {
    getOverview: mockProviderPoolGetOverview,
  },
}));

vi.mock("@/lib/api/apiKeyProvider", () => ({
  apiKeyProviderApi: {
    getProviders: mockApiKeyProvidersGetProviders,
  },
}));

vi.mock("@/lib/providerDataEvents", () => ({
  emitProviderDataChanged: mockEmitProviderDataChanged,
}));

vi.mock("@/lib/api/channelsRuntime", () => ({
  wechatChannelSetRuntimeModel: mockWechatChannelSetRuntimeModel,
}));

import { useAsterAgentChat } from "../hooks/useAsterAgentChat";
import { ChatModelSelector } from "./ChatModelSelector";

interface MountedHarness {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: MountedHarness[] = [];

interface MountOptions {
  onManageProviders?: () => void;
  chatModelSelectorProps?: Partial<
    React.ComponentProps<typeof ChatModelSelector>
  >;
}

function createModel(id: string, providerId: string) {
  return {
    id,
    display_name: id,
    provider_id: providerId,
    provider_name: providerId,
    family: null,
    tier: "pro",
    capabilities: {
      vision: false,
      tools: true,
      streaming: true,
      json_mode: true,
      function_calling: true,
      reasoning: false,
    },
    pricing: null,
    limits: {
      context_length: null,
      max_output_tokens: null,
      requests_per_minute: null,
      tokens_per_minute: null,
    },
    status: "active",
    release_date: null,
    is_latest: false,
    description: id,
    source: "custom",
    created_at: Date.now() / 1000,
    updated_at: Date.now() / 1000,
  };
}

function mount(
  workspaceId: string,
  options: MountOptions = {},
): HTMLDivElement {
  const { onManageProviders, chatModelSelectorProps } = options;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  function TestComponent() {
    const chat = useAsterAgentChat({ workspaceId });
    return (
      <div>
        <button
          data-testid="switch-topic-a"
          onClick={() => {
            void chat.switchTopic("topic-a");
          }}
        >
          切到 topic-a
        </button>
        <button
          data-testid="switch-topic-b"
          onClick={() => {
            void chat.switchTopic("topic-b");
          }}
        >
          切到 topic-b
        </button>
        <ChatModelSelector
          providerType={chat.providerType}
          setProviderType={chat.setProviderType}
          model={chat.model}
          setModel={chat.setModel}
          activeTheme="general"
          onManageProviders={onManageProviders}
          {...chatModelSelectorProps}
        />
        <div data-testid="current-model">
          {chat.providerType}/{chat.model}
        </div>
      </div>
    );
  }

  act(() => {
    root.render(<TestComponent />);
  });

  mountedRoots.push({ container, root });
  return container;
}

function getButtonByTestId(
  container: HTMLElement,
  testId: string,
): HTMLButtonElement {
  const button = container.querySelector(
    `[data-testid="${testId}"]`,
  ) as HTMLButtonElement | null;
  if (!button) {
    throw new Error(`未找到按钮: ${testId}`);
  }
  return button;
}

function getComboboxTrigger(container: HTMLElement): HTMLButtonElement {
  const trigger = container.querySelector(
    'button[role="combobox"]',
  ) as HTMLButtonElement | null;
  if (!trigger) {
    throw new Error("未找到模型选择触发器");
  }
  return trigger;
}

function findButtonByText(
  text: string,
  options: { excludeCombobox?: boolean } = {},
): HTMLButtonElement {
  const { excludeCombobox = false } = options;
  const target = Array.from(document.querySelectorAll("button")).find(
    (node) => {
      if (excludeCombobox && node.getAttribute("role") === "combobox") {
        return false;
      }
      return node.textContent?.includes(text);
    },
  );
  if (!target) {
    throw new Error(`未找到按钮文本: ${text}`);
  }
  return target as HTMLButtonElement;
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();

  mockInitAsterAgent.mockResolvedValue(undefined);
  mockCreateAgentRuntimeSession.mockResolvedValue("created-session");
  mockUpdateAgentRuntimeSession.mockResolvedValue(undefined);
  mockSafeListen.mockResolvedValue(() => {});
  mockProviderPoolGetOverview.mockResolvedValue([]);
  mockApiKeyProvidersGetProviders.mockResolvedValue([]);
  mockEmitProviderDataChanged.mockImplementation(() => {});
  mockWechatChannelSetRuntimeModel.mockResolvedValue(undefined);

  const createdAt = Math.floor(Date.now() / 1000);
  mockListAgentRuntimeSessions.mockResolvedValue([
    {
      id: "topic-a",
      name: "话题 A",
      created_at: createdAt,
      updated_at: createdAt,
      messages_count: 0,
    },
    {
      id: "topic-b",
      name: "话题 B",
      created_at: createdAt,
      updated_at: createdAt,
      messages_count: 0,
    },
  ]);
  mockGetAgentRuntimeSession.mockImplementation(async (topicId: string) => ({
    id: topicId,
    created_at: createdAt,
    updated_at: createdAt,
    messages: [],
    execution_strategy: "react",
    turns: [],
    items: [],
    queued_turns: [],
  }));

  mockUseConfiguredProviders.mockReturnValue({
    providers: [
      { key: "gemini", label: "Gemini", registryId: "gemini", type: "gemini" },
      {
        key: "deepseek",
        label: "DeepSeek",
        registryId: "deepseek",
        type: "deepseek",
      },
    ],
    loading: false,
  });

  mockUseProviderModels.mockImplementation(
    (selectedProvider: { key: string } | null) => {
      const key = selectedProvider?.key;
      const models =
        key === "gemini"
          ? [
              createModel("gemini-2.5-pro", "gemini"),
              createModel("gemini-2.5-flash", "gemini"),
            ]
          : key === "deepseek"
            ? [
                createModel("deepseek-chat", "deepseek"),
                createModel("deepseek-reasoner", "deepseek"),
              ]
            : [];

      return {
        modelIds: models.map((item) => item.id),
        models,
        loading: false,
        error: null,
      };
    },
  );
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
  localStorage.clear();
  sessionStorage.clear();
});

describe("ChatModelSelector + useAsterAgentChat 集成", () => {
  it("通过 UI 选择模型后切换话题再切回，应恢复会话模型", async () => {
    const workspaceId = "ws-model-selector-integration";
    const container = mount(workspaceId);

    await flushEffects();
    await flushEffects();

    await act(async () => {
      getButtonByTestId(container, "switch-topic-a").click();
    });
    await flushEffects();

    await act(async () => {
      getComboboxTrigger(container).click();
    });
    await flushEffects();

    await act(async () => {
      findButtonByText("Gemini", { excludeCombobox: true }).click();
    });
    await flushEffects();

    await act(async () => {
      findButtonByText("gemini-2.5-pro", { excludeCombobox: true }).click();
    });
    await flushEffects();

    await act(async () => {
      getButtonByTestId(container, "switch-topic-b").click();
    });
    await flushEffects();

    await act(async () => {
      getComboboxTrigger(container).click();
    });
    await flushEffects();

    await act(async () => {
      findButtonByText("DeepSeek", { excludeCombobox: true }).click();
    });
    await flushEffects();

    await act(async () => {
      findButtonByText("deepseek-chat", { excludeCombobox: true }).click();
    });
    await flushEffects();

    await act(async () => {
      getButtonByTestId(container, "switch-topic-a").click();
    });
    await flushEffects();

    const currentModel = container.querySelector(
      '[data-testid="current-model"]',
    ) as HTMLDivElement | null;
    expect(currentModel?.textContent).toContain("gemini/gemini-2.5-pro");

    expect(
      JSON.parse(
        localStorage.getItem(`agent_topic_model_pref_${workspaceId}_topic-a`) ||
          "null",
      ),
    ).toEqual({
      providerType: "gemini",
      model: "gemini-2.5-pro",
    });
    expect(
      JSON.parse(
        localStorage.getItem(`agent_topic_model_pref_${workspaceId}_topic-b`) ||
          "null",
      ),
    ).toEqual({
      providerType: "deepseek",
      model: "deepseek-chat",
    });
  });

  it("无 Provider 时应显示配置引导并支持点击配置", async () => {
    mockUseConfiguredProviders.mockReturnValue({
      providers: [],
      loading: false,
    });
    mockUseProviderModels.mockReturnValue({
      modelIds: [],
      models: [],
      loading: false,
      error: null,
    });

    const onManageProviders = vi.fn();
    const container = mount("ws-no-provider-guide", { onManageProviders });

    await flushEffects();

    expect(container.textContent).toContain("工具模型未配置");

    const configButton = findButtonByText("配置");
    await act(async () => {
      configButton.click();
    });

    expect(onManageProviders).toHaveBeenCalledTimes(1);
  });

  it("关闭后台预加载时，应在打开选择器后再加载 Provider 和模型", async () => {
    const container = mount("ws-model-selector-lazy-provider-load", {
      chatModelSelectorProps: {
        backgroundPreload: "disabled",
      },
    });

    await flushEffects();

    expect(
      mockUseConfiguredProviders.mock.calls.some(
        ([options]) => options?.autoLoad === false,
      ),
    ).toBe(true);
    expect(
      mockUseConfiguredProviders.mock.calls.some(
        ([options]) => options?.autoLoad === true,
      ),
    ).toBe(false);

    expect(
      mockUseProviderModels.mock.calls.some(
        ([, options]) => options?.autoLoad === false,
      ),
    ).toBe(true);
    expect(
      mockUseProviderModels.mock.calls.some(
        ([, options]) => options?.autoLoad === true,
      ),
    ).toBe(false);

    await act(async () => {
      getComboboxTrigger(container).click();
    });
    await flushEffects();

    expect(
      mockUseConfiguredProviders.mock.calls.some(
        ([options]) => options?.autoLoad === true,
      ),
    ).toBe(true);
    expect(
      mockUseProviderModels.mock.calls.some(
        ([, options]) => options?.autoLoad === true,
      ),
    ).toBe(true);
  });
});
