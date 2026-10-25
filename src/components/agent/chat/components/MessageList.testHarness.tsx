/* eslint-disable react-refresh/only-export-components */
import React from "react";
import { act } from "react";
import { createRoot as reactCreateRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { MessageList as MessageListComponent } from "./MessageList";
import type {
  AgentThreadItem,
  AgentThreadTurn,
  Message,
  MessagePreviewTarget,
} from "../types";
import {
  clearAgentUiPerformanceMetrics,
  getAgentUiPerformanceMetrics as readAgentUiPerformanceMetrics,
} from "@/lib/agentUiPerformanceMetrics";
import {
  clearAllAgentStreamTextOverlays,
  upsertAgentStreamTextOverlay as upsertAgentStreamTextOverlayEntry,
} from "../hooks/agentStreamTextOverlayStore";

export const IMAGE_WORKBENCH_FOCUS_EVENT = "lime:image-workbench-focus";
export const IMAGE_WORKBENCH_TASK_ACTION_EVENT =
  "lime:image-workbench-task-action";
export const VIDEO_WORKBENCH_TASK_ACTION_EVENT =
  "lime:video-workbench-task-action";
export type MockConfiguredProvider = {
  key: string;
  label?: string;
  registryId?: string;
  type?: string;
  providerId?: string;
};

export function isMockToolUsePart(
  part: Record<string, unknown>,
): part is Record<string, unknown> & {
  toolCall: { id?: string; name?: string; status?: string };
} {
  return (
    part.type === "tool_use" &&
    Boolean(part.toolCall) &&
    typeof part.toolCall === "object"
  );
}

export type StreamingRendererCallProps = {
  content?: string;
  contentParts?: Array<Record<string, unknown>>;
  onOpenMediaReference?: (reference: unknown, index: number) => void;
  onOpenSavedSiteContent?: unknown;
  toolCalls?: unknown[];
};

export const WEB_TOOL_START_TIME = new Date("2026-06-20T14:49:11.000Z");
const MOCK_AGENT_THREAD_TIMELINE_LABEL = "执行轨迹";

export function findStreamingRendererCallByContent(
  content: string,
): StreamingRendererCallProps | undefined {
  return mockStreamingRenderer.mock.calls.find(
    ([props]) => (props as StreamingRendererCallProps).content === content,
  )?.[0] as StreamingRendererCallProps | undefined;
}

export const mockUseConfiguredProviders = vi.fn((_options?: unknown) => ({
  providers: [] as MockConfiguredProvider[],
  loading: false,
}));
export const mockFindConfiguredProviderBySelection = vi.fn(
  (
    _providers: MockConfiguredProvider[],
    _selection?: string | null,
  ): MockConfiguredProvider | null => null,
);
export const mockTokenUsageDisplay = vi.fn(
  ({
    promptCacheNotice,
    inline,
    usage,
  }: {
    promptCacheNotice?: {
      label?: string;
    } | null;
    inline?: boolean;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
    };
  }) => (
    <div data-testid="token-usage-display" data-inline={inline ? "yes" : "no"}>
      {promptCacheNotice?.label ||
        `${
          ((usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0)) / 1_000
        }.0K Tokens`}
    </div>
  ),
);

vi.mock("@/hooks/useConfiguredProviders", () => ({
  useConfiguredProviders: (options?: unknown) =>
    mockUseConfiguredProviders(options),
  findConfiguredProviderBySelection: (
    providers: MockConfiguredProvider[],
    selection?: string | null,
  ) => mockFindConfiguredProviderBySelection(providers, selection),
  resolveConfiguredProviderPromptCacheSupportNotice: (
    providers: MockConfiguredProvider[],
    selection?: string | null,
  ) => {
    const selectedProvider = mockFindConfiguredProviderBySelection(
      providers,
      selection,
    );
    const normalizedConfiguredType = (selectedProvider?.type || "")
      .trim()
      .toLowerCase();
    const normalizedSelection = (selection || "").trim().toLowerCase();

    if (normalizedConfiguredType === "anthropic-compatible") {
      return {
        label: "未声明自动缓存",
        detail:
          "当前 Provider 未声明支持自动 Prompt Cache；如需复用前缀，请使用显式 cache_control 标记。",
        source: "configured_provider" as const,
      };
    }

    if (normalizedSelection === "anthropic-compatible") {
      return {
        label: "未声明自动缓存",
        detail:
          "当前 Provider 未声明支持自动 Prompt Cache；当前提示基于 Provider 选择器回退判断，如需复用前缀，请使用显式 cache_control 标记。",
        source: "selection_fallback" as const,
      };
    }

    return null;
  },
}));

vi.mock("./MarkdownRenderer", () => ({
  MarkdownRenderer: ({
    content,
    readOnlyA2UI,
    renderA2UIInline,
    renderMode,
  }: {
    content: string;
    readOnlyA2UI?: boolean;
    renderA2UIInline?: boolean;
    renderMode?: string;
  }) => (
    <div
      data-testid="markdown-renderer"
      data-read-only-a2ui={readOnlyA2UI ? "yes" : "no"}
      data-render-a2ui-inline={
        renderA2UIInline === undefined ? "default" : String(renderA2UIInline)
      }
      data-render-mode={renderMode || "standard"}
    >
      {content || "<empty>"}
    </div>
  ),
}));

export const mockStreamingRenderer = vi.fn(
  ({
    content,
    contentParts,
    thinkingContent,
    toolCalls,
    onOpenUrlPreview,
    onOpenMediaReference,
    onOpenSavedSiteContent,
    suppressProcessFlow,
    showRuntimeStatusInline,
    renderProposedPlanBlocks,
    showContentBlockActions,
    onQuoteContent,
    markdownRenderMode,
    readOnlyA2UI,
    readOnlyActionRequests,
    isStreaming,
  }: {
    content: string;
    contentParts?: unknown[];
    thinkingContent?: string;
    toolCalls?: unknown[];
    isStreaming?: boolean;
    renderA2UIInline?: boolean;
    suppressProcessFlow?: boolean;
    showRuntimeStatusInline?: boolean;
    renderProposedPlanBlocks?: boolean;
    showContentBlockActions?: boolean;
    onQuoteContent?: (content: string) => void;
    markdownRenderMode?: string;
    readOnlyA2UI?: boolean;
    readOnlyActionRequests?: boolean;
    onOpenUrlPreview?: (target: unknown) => void;
    onOpenMediaReference?: (reference: unknown, index: number) => void;
    onOpenSavedSiteContent?: (target: {
      projectId: string;
      contentId: string;
      title?: string;
    }) => void;
  }) => (
    <div
      data-testid="streaming-renderer"
      data-content-parts={contentParts?.length ?? 0}
      data-tool-calls={toolCalls?.length ?? 0}
      data-has-thinking-content={thinkingContent ? "yes" : "no"}
      data-has-open-url-preview={onOpenUrlPreview ? "yes" : "no"}
      data-has-open-media-reference={onOpenMediaReference ? "yes" : "no"}
      data-has-open-saved-site-content={onOpenSavedSiteContent ? "yes" : "no"}
      data-suppress-process-flow={suppressProcessFlow ? "yes" : "no"}
      data-show-runtime-status-inline={showRuntimeStatusInline ? "yes" : "no"}
      data-render-proposed-plan-blocks={renderProposedPlanBlocks ? "yes" : "no"}
      data-show-content-block-actions={showContentBlockActions ? "yes" : "no"}
      data-has-on-quote-content={onQuoteContent ? "yes" : "no"}
      data-markdown-render-mode={markdownRenderMode || "standard"}
      data-read-only-a2ui={readOnlyA2UI ? "yes" : "no"}
      data-read-only-action-requests={readOnlyActionRequests ? "yes" : "no"}
      data-is-streaming={isStreaming ? "yes" : "no"}
    >
      {content || "<empty-assistant>"}
    </div>
  ),
);
export const mockAgentThreadTimeline = vi.fn(
  ({
    actionRequests,
    items,
    onOpenSavedSiteContent,
    placement,
    turn,
    expandCompletedProcessDetails,
  }: {
    actionRequests?: Array<Record<string, unknown>>;
    items?: AgentThreadItem[];
    onOpenSavedSiteContent?: (target: {
      projectId: string;
      contentId: string;
      title?: string;
    }) => void;
    deferCompletedSingleDetails?: boolean;
    expandCompletedProcessDetails?: boolean;
    placement?: "leading" | "trailing" | "default";
    turn?: { id?: string } | null;
  }) => (
    <div
      data-testid={`agent-thread-timeline:${placement || "default"}`}
      data-expand-completed-process-details={
        expandCompletedProcessDetails ? "yes" : "no"
      }
      data-has-open-saved-site-content={onOpenSavedSiteContent ? "yes" : "no"}
      data-turn-id={turn?.id || ""}
      data-item-ids={items?.map((item) => item.id).join(",")}
    >
      {MOCK_AGENT_THREAD_TIMELINE_LABEL}
      {actionRequests?.length ? `:${actionRequests.length}` : ""}
      {(items || [])
        .filter(
          (item) => item.type === "web_search" || item.type === "tool_call",
        )
        .map((item) => (
          <span
            key={item.id}
            data-testid="timeline-process-item"
            data-item-status={item.status}
          />
        ))}
      {(items || [])
        .filter((item) => item.type === "unknown_item")
        .map((item) => (
          <span key={item.id} data-testid="timeline-unsupported-item">
            {item.upstream_type} {item.field_names.join(" ")}
          </span>
        ))}
      {(items || [])
        .filter((item) => item.type === "file_artifact")
        .map((item) => (
          <span
            key={item.id}
            data-testid="timeline-file-artifact-card"
            data-artifact-path={item.path}
          />
        ))}
    </div>
  ),
);

vi.mock("./StreamingRenderer", () => ({
  StreamingRenderer: (props: {
    content: string;
    renderA2UIInline?: boolean;
    markdownRenderMode?: string;
    readOnlyA2UI?: boolean;
    readOnlyActionRequests?: boolean;
  }) => mockStreamingRenderer(props),
}));

vi.mock("./TokenUsageDisplay", () => ({
  TokenUsageDisplay: (props: {
    promptCacheNotice?: {
      label?: string;
    } | null;
    inline?: boolean;
  }) => mockTokenUsageDisplay(props),
}));

vi.mock("./AgentThreadTimeline", () => ({
  AgentThreadTimeline: (props: {
    actionRequests?: Array<Record<string, unknown>>;
    deferCompletedSingleDetails?: boolean;
    expandCompletedProcessDetails?: boolean;
    items?: AgentThreadItem[];
    placement?: "leading" | "trailing" | "default";
  }) => mockAgentThreadTimeline(props),
}));

interface MountedHarness {
  container: HTMLDivElement;
  root: Root;
}

export const mountedRoots: MountedHarness[] = [];

beforeEach(async () => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  await changeLimeLocale("en-US");
  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = () => {};
  }
  clearAgentUiPerformanceMetrics();
  clearAllAgentStreamTextOverlays();
});

afterEach(async () => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) break;
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  vi.useRealTimers();
  vi.clearAllMocks();
  clearAgentUiPerformanceMetrics();
  clearAllAgentStreamTextOverlays();
  mockUseConfiguredProviders.mockImplementation(() => ({
    providers: [],
    loading: false,
  }));
  mockFindConfiguredProviderBySelection.mockImplementation(() => null);
  await changeLimeLocale("en-US");
});

export function render(
  messages: Message[],
  props?: Partial<React.ComponentProps<typeof MessageListComponent>>,
): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = reactCreateRoot(container);

  act(() => {
    root.render(<MessageListComponent messages={messages} {...props} />);
  });

  mountedRoots.push({ container, root });
  return container;
}

export async function renderZh(
  messages: Message[],
  props?: Partial<React.ComponentProps<typeof MessageListComponent>>,
): Promise<HTMLDivElement> {
  await changeLimeLocale("zh-CN");
  return render(messages, props);
}

export function setScrollMetrics(
  element: HTMLElement,
  metrics: {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
  },
) {
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    writable: true,
    value: metrics.scrollTop,
  });
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    value: metrics.scrollHeight,
  });
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: metrics.clientHeight,
  });
}

export function createConversationMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `message-${index + 1}`,
    role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `消息 ${index + 1}`,
    timestamp: new Date(
      `2026-04-25T10:${String(index % 60).padStart(2, "0")}:00.000Z`,
    ),
  }));
}

export const getAgentUiPerformanceMetrics = readAgentUiPerformanceMetrics;
export const upsertAgentStreamTextOverlay = upsertAgentStreamTextOverlayEntry;
export const createRoot = reactCreateRoot;
export const MessageList = MessageListComponent;
export type { AgentThreadItem, AgentThreadTurn, Message, MessagePreviewTarget };
