import { describe, expect, it, vi, beforeEach } from "vitest";
import { apiKeyProviderApi } from "@/lib/api/apiKeyProvider";
import { getConfig } from "@/lib/api/appConfig";
import {
  getAgentRuntimeSession,
  listAgentRuntimeSessions,
} from "@/lib/api/agentRuntime";
import {
  resetCompanionPetConversationHistory,
  runCompanionPetConversation,
  runCompanionPetQuickAction,
  selectCompanionQuickActionProvider,
} from "./petQuickActions";

vi.mock("@/lib/api/apiKeyProvider", () => ({
  apiKeyProviderApi: {
    getProviders: vi.fn(),
    testChat: vi.fn(),
  },
}));

vi.mock("@/lib/api/appConfig", () => ({
  getConfig: vi.fn(),
}));

vi.mock("@/lib/api/agentRuntime", () => ({
  listAgentRuntimeSessions: vi.fn(),
  getAgentRuntimeSession: vi.fn(),
}));

function createProvider(overrides: Record<string, unknown> = {}) {
  return {
    id: "openai",
    name: "OpenAI",
    type: "openai",
    api_host: "https://api.openai.com/v1",
    is_system: true,
    group: "cloud",
    enabled: true,
    sort_order: 0,
    custom_models: [],
    api_key_count: 1,
    api_keys: [
      {
        id: "key-1",
        provider_id: "openai",
        api_key_masked: "sk-***1234",
        enabled: true,
        usage_count: 0,
        error_count: 0,
        created_at: "2026-04-02T00:00:00Z",
      },
    ],
    created_at: "2026-04-02T00:00:00Z",
    updated_at: "2026-04-02T00:00:00Z",
    ...overrides,
  };
}

describe("petQuickActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    resetCompanionPetConversationHistory();
    vi.mocked(getConfig).mockResolvedValue({
      workspace_preferences: {},
    } as never);
    vi.mocked(listAgentRuntimeSessions).mockResolvedValue([]);
    vi.mocked(getAgentRuntimeSession).mockResolvedValue({
      execution_runtime: null,
    } as never);
  });

  it("应优先选择启用且有可用 key 的服务商", () => {
    const selected = selectCompanionQuickActionProvider([
      createProvider({
        id: "disabled-openai",
        enabled: false,
      }),
      createProvider({
        id: "deepseek",
        name: "DeepSeek",
        sort_order: 1,
      }),
      createProvider({
        id: "openai",
        sort_order: 10,
      }),
    ]);

    expect(selected?.id).toBe("deepseek");
  });

  it("执行鼓励动作时，应调用 chat 测试接口并输出短气泡", async () => {
    vi.mocked(apiKeyProviderApi.getProviders).mockResolvedValue([
      createProvider({
        id: "deepseek",
        name: "DeepSeek",
      }),
    ]);
    vi.mocked(apiKeyProviderApi.testChat).mockResolvedValue({
      success: true,
      content: "  继续向前，青柠陪你一起做完它  ",
      latency_ms: 88,
    });

    await expect(runCompanionPetQuickAction("cheer")).resolves.toEqual({
      bubbleText: "继续向前，青柠陪你一起做完它",
      providerId: "deepseek",
      latencyMs: 88,
    });
    expect(apiKeyProviderApi.testChat).toHaveBeenCalledWith(
      "deepseek",
      undefined,
      expect.stringContaining("Lime 青柠精灵"),
    );
  });

  it("执行桌宠对话时，应复用宿主侧 provider 并生成短回复", async () => {
    vi.mocked(apiKeyProviderApi.getProviders).mockResolvedValue([
      createProvider({
        id: "deepseek",
        name: "DeepSeek",
      }),
    ]);
    vi.mocked(apiKeyProviderApi.testChat).mockResolvedValue({
      success: true,
      content: "  [joy] 今天先把节奏放慢一点，我陪你一起往前走。  ",
      latency_ms: 96,
    });

    await expect(
      runCompanionPetConversation("今天有点累，你在吗"),
    ).resolves.toEqual({
      bubbleText: "今天先把节奏放慢一点，我陪你一起往前走。",
      providerId: "deepseek",
      latencyMs: 96,
      live2dAction: {
        emotion_tags: ["joy"],
      },
    });

    expect(apiKeyProviderApi.testChat).toHaveBeenCalledWith(
      "deepseek",
      undefined,
      expect.stringContaining("今天有点累，你在吗"),
    );
    expect(apiKeyProviderApi.testChat).toHaveBeenCalledWith(
      "deepseek",
      undefined,
      expect.stringContaining("[joy]"),
    );
  });

  it("桌宠连续对话时，应把最近几轮上下文带进下一次请求", async () => {
    vi.mocked(apiKeyProviderApi.getProviders).mockResolvedValue([
      createProvider({
        id: "deepseek",
        name: "DeepSeek",
      }),
    ]);
    vi.mocked(apiKeyProviderApi.testChat)
      .mockResolvedValueOnce({
        success: true,
        content: "[joy]当然在，我陪你慢慢来",
        latency_ms: 90,
      })
      .mockResolvedValueOnce({
        success: true,
        content: "那我们先把最小的一步做完",
        latency_ms: 92,
      });

    await runCompanionPetConversation("今天有点累");
    await runCompanionPetConversation("那我现在先做什么");

    expect(apiKeyProviderApi.testChat).toHaveBeenNthCalledWith(
      2,
      "deepseek",
      undefined,
      expect.stringContaining("用户：今天有点累"),
    );
    expect(apiKeyProviderApi.testChat).toHaveBeenNthCalledWith(
      2,
      "deepseek",
      undefined,
      expect.stringContaining("青柠：当然在，我陪你慢慢来"),
    );
  });

  it("已设置桌宠通用模型时，应优先使用桌宠专用 provider/model", async () => {
    vi.mocked(getConfig).mockResolvedValue({
      workspace_preferences: {
        companion_defaults: {
          general: {
            preferredProviderId: "openai",
            preferredModelId: "gpt-4.1",
            allowFallback: false,
          },
        },
      },
    } as never);
    vi.mocked(apiKeyProviderApi.getProviders).mockResolvedValue([
      createProvider({
        id: "openai",
        name: "OpenAI",
        custom_models: ["gpt-4.1"],
      }),
      createProvider({
        id: "deepseek",
        name: "DeepSeek",
        sort_order: 1,
      }),
    ]);
    vi.mocked(apiKeyProviderApi.testChat).mockResolvedValue({
      success: true,
      content: "青柠就按你的专属模型来啦",
      latency_ms: 120,
    });

    await runCompanionPetQuickAction("cheer");

    expect(apiKeyProviderApi.testChat).toHaveBeenCalledWith(
      "openai",
      "gpt-4.1",
      expect.any(String),
    );
  });

  it("未设置桌宠模型时，应优先回退最近当前 provider/model", async () => {
    vi.mocked(apiKeyProviderApi.getProviders).mockResolvedValue([
      createProvider({
        id: "openai",
        name: "OpenAI",
        sort_order: 10,
      }),
      createProvider({
        id: "deepseek",
        name: "DeepSeek",
        sort_order: 20,
      }),
    ]);
    vi.mocked(listAgentRuntimeSessions).mockResolvedValue([
      {
        id: "session-1",
        created_at: 1,
        updated_at: 20,
        workspace_id: "workspace-a",
      },
    ] as never);
    vi.mocked(getAgentRuntimeSession).mockResolvedValue({
      execution_runtime: {
        provider_selector: "deepseek",
        provider_name: "DeepSeek",
        model_name: "deepseek-chat",
      },
    } as never);
    vi.mocked(apiKeyProviderApi.testChat).mockResolvedValue({
      success: true,
      content: "先把最小的一步做掉",
      latency_ms: 66,
    });

    await runCompanionPetQuickAction("next-step");

    expect(apiKeyProviderApi.testChat).toHaveBeenCalledWith(
      "deepseek",
      "deepseek-chat",
      expect.any(String),
    );
  });

  it("当前 provider 不可用时，应自动回退到可聊天服务商", async () => {
    vi.mocked(apiKeyProviderApi.getProviders).mockResolvedValue([
      createProvider({
        id: "openai",
        name: "OpenAI",
        sort_order: 1,
      }),
    ]);
    vi.mocked(listAgentRuntimeSessions).mockResolvedValue([
      {
        id: "session-2",
        created_at: 1,
        updated_at: 30,
      },
    ] as never);
    vi.mocked(getAgentRuntimeSession).mockResolvedValue({
      execution_runtime: {
        provider_selector: "claude",
        provider_name: "Claude",
        model_name: "claude-sonnet-4-5",
      },
    } as never);
    vi.mocked(apiKeyProviderApi.testChat).mockResolvedValue({
      success: true,
      content: "青柠帮你切到当前可用服务啦",
      latency_ms: 75,
    });

    await runCompanionPetQuickAction("cheer");

    expect(apiKeyProviderApi.testChat).toHaveBeenCalledWith(
      "openai",
      undefined,
      expect.any(String),
    );
  });

  it("没有可聊天服务商时，应给出明确错误", async () => {
    vi.mocked(apiKeyProviderApi.getProviders).mockResolvedValue([]);

    await expect(runCompanionPetQuickAction("next-step")).rejects.toThrow(
      "还没找到可聊天的 AI 服务商",
    );
  });
});
