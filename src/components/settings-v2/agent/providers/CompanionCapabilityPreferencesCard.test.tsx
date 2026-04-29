import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetConfig,
  mockSaveConfig,
  mockGetProviders,
  mockSubscribeProviderDataChanged,
} = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockSaveConfig: vi.fn(),
  mockGetProviders: vi.fn(),
  mockSubscribeProviderDataChanged: vi.fn(),
}));

vi.mock("@/lib/api/appConfig", () => ({
  getConfig: (...args: unknown[]) => mockGetConfig(...args),
  saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
}));

vi.mock("@/lib/api/apiKeyProvider", () => ({
  apiKeyProviderApi: {
    getProviders: (...args: unknown[]) => mockGetProviders(...args),
  },
}));

vi.mock("@/lib/providerDataEvents", () => ({
  subscribeProviderDataChanged: (...args: unknown[]) =>
    mockSubscribeProviderDataChanged(...args),
}));

vi.mock("@/components/input-kit", () => ({
  ModelSelector: ({
    providerType,
    model,
    activeTheme,
    placeholderLabel,
  }: {
    providerType: string;
    model: string;
    activeTheme?: string;
    placeholderLabel?: string;
  }) => (
    <div data-testid="companion-model-selector">
      {activeTheme ? `[${activeTheme}] ` : ""}
      {providerType || placeholderLabel || "自动选择"} /{" "}
      {model || placeholderLabel || "自动选择"}
    </div>
  ),
}));

import { CompanionCapabilityPreferencesCard } from "./CompanionCapabilityPreferencesCard";

interface MountedCard {
  container: HTMLDivElement;
  root: Root;
}

const mounted: MountedCard[] = [];

function renderCard() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<CompanionCapabilityPreferencesCard />);
  });

  mounted.push({ container, root });
  return container;
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function findButton(container: HTMLElement, text: string) {
  const button = Array.from(container.querySelectorAll("button")).find((item) =>
    item.textContent?.includes(text),
  );

  if (!button) {
    throw new Error(`未找到按钮: ${text}`);
  }

  return button as HTMLButtonElement;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  vi.useFakeTimers();
  vi.clearAllMocks();

  mockGetConfig.mockResolvedValue({
    workspace_preferences: {
      companion_defaults: {
        general: {
          preferredProviderId: "deepseek",
          preferredModelId: "deepseek-chat",
          allowFallback: false,
        },
      },
    },
  });
  mockSaveConfig.mockResolvedValue(undefined);
  mockGetProviders.mockResolvedValue([
    {
      id: "deepseek",
      name: "DeepSeek",
      type: "openai",
      api_host: "https://api.deepseek.com/v1",
      is_system: false,
      group: "cloud",
      enabled: true,
      sort_order: 1,
      custom_models: ["deepseek-chat", "deepseek-reasoner"],
      api_key_count: 1,
      api_keys: [
        {
          id: "key-deepseek-1",
          provider_id: "deepseek",
          api_key_masked: "sk-***1234",
          enabled: true,
          usage_count: 0,
          error_count: 0,
          created_at: "2026-04-02T00:00:00Z",
        },
      ],
      created_at: "2026-04-02T00:00:00Z",
      updated_at: "2026-04-02T00:00:00Z",
    },
    {
      id: "openai-tts",
      name: "OpenAI TTS",
      type: "openai",
      api_host: "https://api.openai.com/v1",
      is_system: false,
      group: "cloud",
      enabled: true,
      sort_order: 2,
      custom_models: ["gpt-4o-mini-tts"],
      api_key_count: 1,
      api_keys: [
        {
          id: "key-openai-tts-1",
          provider_id: "openai-tts",
          api_key_masked: "sk-***5678",
          enabled: true,
          usage_count: 0,
          error_count: 0,
          created_at: "2026-04-02T00:00:00Z",
        },
      ],
      created_at: "2026-04-02T00:00:00Z",
      updated_at: "2026-04-02T00:00:00Z",
    },
  ]);
  mockSubscribeProviderDataChanged.mockReturnValue(vi.fn());
});

afterEach(() => {
  while (mounted.length > 0) {
    const current = mounted.pop();
    if (!current) {
      break;
    }

    act(() => {
      current.root.unmount();
    });
    current.container.remove();
  }

  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("CompanionCapabilityPreferencesCard", () => {
  it("应只展示已接入主链的桌宠通用模型偏好", async () => {
    const container = renderCard();
    await flushEffects();

    expect(container.textContent).toContain("桌宠能力偏好");
    expect(container.textContent).toContain("桌宠通用模型");
    expect(container.textContent).toContain("最近当前 provider/model");
    expect(container.textContent).toContain(
      "[general] deepseek / deepseek-chat",
    );
    expect(container.textContent).not.toContain("桌宠语音播报");
    expect(
      container.querySelectorAll("[data-testid='companion-model-selector']"),
    ).toHaveLength(1);
  });

  it("恢复通用默认时应清空 companion_defaults.general", async () => {
    const container = renderCard();
    await flushEffects();

    await act(async () => {
      findButton(container, "恢复通用默认").click();
      await flushEffects();
    });

    expect(mockSaveConfig).toHaveBeenCalledTimes(1);
    const savedConfig = mockSaveConfig.mock.calls[0][0];
    expect(
      savedConfig.workspace_preferences.companion_defaults.general,
    ).toBeUndefined();
    expect(
      savedConfig.workspace_preferences.companion_defaults.tts,
    ).toBeUndefined();
    expect(container.textContent).toContain("桌宠能力偏好已保存");
  });
});
