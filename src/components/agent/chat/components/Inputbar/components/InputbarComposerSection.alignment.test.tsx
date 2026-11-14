import React from "react";
import { stubSuggestionGeometry } from "./contextualSuggestions.testFixtures";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatInputAdapter } from "@/components/input-kit/adapters/types";
import {
  ComposerController,
  type ComposerEditorHandle,
} from "@/components/input-kit";
import {
  COMPOSER_EDITOR_SELECTOR,
  getComposerEditorText,
} from "@/components/input-kit/composerEditor.testUtils";
import { changeLimeLocale } from "@/i18n/createI18n";
import { agentZhCNResource } from "@/i18n/agentResources";
import { createModelMetadata } from "@/components/input-kit/ModelSelector.testFixtures";
import { buildModelReasoningPolicy } from "@/lib/model/modelReasoningPolicy";
import { InputbarComposerSection } from "./InputbarComposerSection";
import {
  buildInputbarComposerSectionCopy,
  type InputbarComposerSectionCopyKey,
} from "./inputbarComposerSectionCopy";
import {
  buildInputbarCoreCopy,
  type InputbarCoreCopyKey,
} from "./inputbarCoreCopy";
import {
  buildInputbarWorkflowPanelCopy,
  type InputbarWorkflowCopyKey,
} from "../inputbarWorkflowCopy";
import type { SkillSelectionProps } from "../../../skill-selection/skillSelectionBindings";

const {
  mockUseConfiguredProviders,
  mockUseProviderModels,
  mockFilterModelsByTheme,
  mockReadModelProviderCapabilities,
} = vi.hoisted(() => ({
  mockUseConfiguredProviders: vi.fn(),
  mockUseProviderModels: vi.fn(),
  mockFilterModelsByTheme: vi.fn(),
  mockReadModelProviderCapabilities: vi.fn(),
}));

vi.mock("@/hooks/useConfiguredProviders", () => ({
  useConfiguredProviders: (...args: unknown[]) =>
    mockUseConfiguredProviders(...args),
  findConfiguredProviderBySelection: (
    providers: Array<{ key: string; providerId?: string }>,
    selection?: string | null,
  ) =>
    providers.find(
      (provider) =>
        provider.key === selection || provider.providerId === selection,
    ) ?? null,
}));

vi.mock("@/hooks/useProviderModels", () => ({
  useProviderModels: (...args: unknown[]) => mockUseProviderModels(...args),
}));

vi.mock("@/components/agent/chat/utils/modelThemePolicy", () => ({
  filterModelsByTheme: (...args: unknown[]) => mockFilterModelsByTheme(...args),
}));

vi.mock("@/lib/api/modelRegistry", () => ({
  modelRegistryApi: {
    readModelProviderCapabilities: (...args: unknown[]) =>
      mockReadModelProviderCapabilities(...args),
  },
}));

vi.mock("@/lib/api/asrProvider", () => ({
  polishVoiceInputText: vi.fn(),
  transcribeVoiceInputAudio: vi.fn(),
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function translateResource(
  key:
    | InputbarComposerSectionCopyKey
    | InputbarCoreCopyKey
    | InputbarWorkflowCopyKey,
  values?: Record<string, number | string>,
) {
  return Object.entries(values ?? {}).reduce(
    (text, [name, value]) => text.split(`{{${name}}}`).join(String(value)),
    agentZhCNResource[key] ?? key,
  );
}

const defaultSkillSelection: SkillSelectionProps = {
  skills: [],
  isSkillsLoading: false,
};

function createInputAdapter(): ChatInputAdapter {
  return {
    state: {
      text: "",
      isSending: false,
      disabled: false,
      attachments: [],
    },
    model: {
      providerType: "custom-local-cli",
      model: "gpt-5.2-codex",
      reasoningEffort: "medium",
    },
    actions: {
      setText: vi.fn(),
      send: vi.fn(),
      stop: vi.fn(),
      setProviderType: vi.fn(),
      setModel: vi.fn(),
      setReasoningEffort: vi.fn(),
    },
    ui: {
      showModelSelector: true,
      showToolBar: true,
    },
  };
}

beforeEach(async () => {
  stubSuggestionGeometry();
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  await changeLimeLocale("zh-CN");
  mockUseConfiguredProviders.mockReturnValue({
    providers: [
      {
        key: "custom-local-cli",
        label: "Local CLI Custom",
        registryId: "custom-local-cli",
        fallbackRegistryId: "codex",
        type: "codex",
        providerId: "custom-local-cli",
        apiHost: "https://api.example.test/v1",
      },
    ],
    loading: false,
  });
  mockUseProviderModels.mockReturnValue({
    modelIds: ["gpt-5.2-codex"],
    models: [
      createModelMetadata("gpt-5.2-codex", {
        capabilities: { reasoning: true, vision: true },
        reasoning_policy: buildModelReasoningPolicy({
          defaultReasoningLevel: "medium",
          supportedReasoningLevels: ["low", "medium", "high"],
        }),
      }),
    ],
    loading: false,
    error: null,
  });
  mockFilterModelsByTheme.mockImplementation((_theme, models) => ({
    models,
    usedFallback: false,
    filteredOutCount: 0,
    policyName: "none",
  }));
  mockReadModelProviderCapabilities.mockResolvedValue({
    namespaceTools: true,
    imageGeneration: true,
    webSearch: false,
    realtime: false,
    realtimeBlockers: [
      "providerRealtimeUnsupported",
      "realtimeTransportUnimplemented",
    ],
  });
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) {
      break;
    }
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
});

describe("InputbarComposerSection empty draft", () => {
  it("空草稿仍同时保留附件、语音、模型、reasoning 和发送", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const editorRef = React.createRef<ComposerEditorHandle>();
    const composerController = new ComposerController();

    act(() => {
      root.render(
        <InputbarComposerSection
          renderWorkflowGeneratingPanel={false}
          workflowGate={null}
          workflowQuickActions={[]}
          workflowQueueItems={[]}
          workflowActiveItem={null}
          workflowQueueTotalCount={0}
          workflowCompletedCount={0}
          workflowTotalCount={0}
          workflowProgressLabel=""
          workflowSummaryLabel=""
          inputAdapter={createInputAdapter()}
          composerController={composerController}
          skillSelection={defaultSkillSelection}
          editorRef={editorRef}
          input=""
          onSelectInputCapability={vi.fn()}
          onSend={vi.fn()}
          onToolClick={vi.fn()}
          activeTools={{}}
          pendingImages={[]}
          onRemoveImage={vi.fn()}
          pathReferences={[]}
          onPaste={vi.fn()}
          isFullscreen={false}
          isWorkspaceVariant={true}
          showModelControls
          reasoningEffort="medium"
          setReasoningEffort={vi.fn()}
          copy={buildInputbarComposerSectionCopy(translateResource)}
          inputbarCopy={buildInputbarCoreCopy(translateResource)}
          workflowPanelCopy={buildInputbarWorkflowPanelCopy(translateResource)}
        />,
      );
    });
    mountedRoots.push({ root, container });

    expect(
      getComposerEditorText(container.querySelector(COMPOSER_EDITOR_SELECTOR)),
    ).toBe("");
    expect(editorRef.current?.getElement()).toBe(
      container.querySelector(COMPOSER_EDITOR_SELECTOR),
    );
    expect(
      container.querySelector('[data-testid="inputbar-dictation-toggle"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-testid="send-btn"]')).not.toBeNull();
    const modelSelector = container.querySelector(
      '[data-testid="model-selector"]',
    ) as HTMLButtonElement | null;
    expect(modelSelector).not.toBeNull();

    const actionRow = container.querySelector(
      '[data-testid="inputbar-meta-left"]',
    );
    expect(actionRow).not.toBeNull();
    expect(
      actionRow?.closest("[data-composer-leading-controls]"),
    ).not.toBeNull();
    expect(
      modelSelector
        ?.closest("[data-composer-trailing-controls]")
        ?.querySelector('[data-testid="send-btn"]'),
    ).not.toBeNull();

    const plusTrigger = container.querySelector(
      '[data-testid="inputbar-plus-trigger"]',
    ) as HTMLButtonElement | null;
    expect(plusTrigger).not.toBeNull();

    act(() => {
      (
        container.querySelector(
          '[data-testid="model-selector"]',
        ) as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      document.body.querySelector(
        '[data-testid="model-selector-reasoning-effort"]',
      ),
    ).not.toBeNull();

    act(() => {
      plusTrigger?.click();
    });
    expect(
      document.body.querySelector(
        '[data-suggestion-key="context-action:pick-local-files"]',
      ),
    ).not.toBeNull();
  });
});
