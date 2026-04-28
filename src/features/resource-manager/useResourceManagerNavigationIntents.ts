import { useCallback, useEffect, useRef } from "react";
import { buildClawAgentParams } from "@/lib/workspace/navigation";
import {
  hasTauriEventCapability,
  hasTauriInvokeCapability,
} from "@/lib/tauri-runtime";
import type { Page, PageParams, ResourcesPageParams } from "@/types/page";
import {
  RESOURCE_MANAGER_NAVIGATION_INTENT_EVENT,
  RESOURCE_MANAGER_NAVIGATION_INTENT_KEY,
  isResourceManagerNavigationIntentFresh,
  markResourceManagerNavigationIntentConsumed,
  normalizeResourceManagerNavigationIntent,
  parseResourceManagerNavigationIntent,
  readConsumedResourceManagerNavigationIntentId,
  readResourceManagerNavigationIntent,
  type ResourceManagerNavigationIntent,
} from "./resourceManagerIntents";

export interface ResourceManagerNavigationDestination {
  page: Page;
  params: PageParams;
  noticeTitle: string;
  noticeDescription: string;
}

interface ResourceManagerFocusableWindow {
  show?: () => Promise<void>;
  unminimize?: () => Promise<void>;
  setFocus?: () => Promise<void>;
}

interface FocusMainWindowAfterResourceIntentOptions {
  currentWindow?: ResourceManagerFocusableWindow | null;
  browserWindow?: Pick<Window, "focus"> | null;
  useTauriWindow?: boolean;
}

interface UseResourceManagerNavigationIntentsOptions {
  onNavigate: (page: Page, params?: PageParams) => void;
  onHandled?: (params: {
    intent: ResourceManagerNavigationIntent;
    destination: ResourceManagerNavigationDestination;
  }) => void;
  onUnsupported?: (intent: ResourceManagerNavigationIntent) => void;
  storage?: Storage | null;
  now?: () => number;
}

async function runWindowFocusAction(
  action: (() => Promise<void>) | undefined,
): Promise<void> {
  if (!action) {
    return;
  }

  try {
    await action();
  } catch {
    // 系统窗口唤起可能被桌面环境拒绝，回跳导航本身不应因此失败。
  }
}

export async function focusMainWindowAfterResourceIntent(
  options: FocusMainWindowAfterResourceIntentOptions = {},
): Promise<void> {
  const browserWindow =
    options.browserWindow ?? (typeof window === "undefined" ? null : window);
  let currentWindow = options.currentWindow ?? null;
  const shouldUseTauriWindow =
    options.useTauriWindow ?? hasTauriInvokeCapability();

  if (!currentWindow && shouldUseTauriWindow) {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      currentWindow = getCurrentWindow();
    } catch {
      currentWindow = null;
    }
  }

  if (currentWindow) {
    await runWindowFocusAction(currentWindow.show?.bind(currentWindow));
    await runWindowFocusAction(currentWindow.unminimize?.bind(currentWindow));
    await runWindowFocusAction(currentWindow.setFocus?.bind(currentWindow));
    return;
  }

  try {
    browserWindow?.focus();
  } catch {
    // 浏览器 fallback 只做尽力唤起，避免阻断 intent 消费。
  }
}

function createIntentMetadata(intent: ResourceManagerNavigationIntent) {
  return {
    resource_manager_intent: {
      id: intent.id,
      action: intent.action,
      item: intent.item,
      sourceContext: intent.sourceContext,
      createdAt: intent.createdAt,
    },
  };
}

function buildContinueImagePrompt(
  intent: ResourceManagerNavigationIntent,
): string {
  const taskId = intent.sourceContext.taskId?.trim();
  const outputId = intent.sourceContext.outputId?.trim();
  const title = intent.item.title.trim() || "这张图片";
  const sourceRef = [
    taskId ? `任务 ${taskId}` : null,
    outputId ? `输出 ${outputId}` : null,
  ]
    .filter(Boolean)
    .join(" / ");

  return sourceRef
    ? `请基于「${title}」（${sourceRef}）继续生成一版可用变体。`
    : `请基于「${title}」继续生成一版可用变体。`;
}

function normalizeResourcePageCategory(
  value: string | null | undefined,
): ResourcesPageParams["resourceCategory"] | undefined {
  if (
    value === "all" ||
    value === "document" ||
    value === "image" ||
    value === "audio" ||
    value === "video"
  ) {
    return value;
  }

  return undefined;
}

export function resolveResourceManagerNavigationDestination(
  intent: ResourceManagerNavigationIntent,
): ResourceManagerNavigationDestination | null {
  const projectId = intent.sourceContext.projectId?.trim() || undefined;
  const contentId = intent.sourceContext.contentId?.trim() || undefined;
  const threadId = intent.sourceContext.threadId?.trim() || undefined;
  const resourceFolderId =
    intent.sourceContext.resourceFolderId?.trim() || undefined;
  const resourceCategory = normalizeResourcePageCategory(
    intent.sourceContext.resourceCategory,
  );
  const itemTitle = intent.item.title.trim() || "当前资源";
  const metadata = createIntentMetadata(intent);

  if (intent.action === "open_project_resource") {
    const params: ResourcesPageParams = {
      projectId,
      contentId,
      focusIntentId: intent.id,
      focusResourceTitle: itemTitle,
      resourceFolderId,
      resourceCategory,
    };

    return {
      page: "resources",
      params,
      noticeTitle: "已回到项目资料",
      noticeDescription: `正在定位「${itemTitle}」。`,
    };
  }

  if (intent.action === "continue_image_task") {
    return {
      page: "agent",
      params: buildClawAgentParams({
        projectId,
        contentId,
        initialSessionId: threadId,
        initialUserPrompt: buildContinueImagePrompt(intent),
        initialRequestMetadata: metadata,
        entryBannerMessage: `已把「${itemTitle}」带回生成输入框，可继续改图或扩展任务。`,
      }),
      noticeTitle: "已带回生成",
      noticeDescription: `已将「${itemTitle}」作为后续任务输入。`,
    };
  }

  if (intent.action === "locate_chat") {
    return {
      page: "agent",
      params: buildClawAgentParams({
        projectId,
        contentId,
        initialSessionId: threadId,
        initialRequestMetadata: metadata,
        entryBannerMessage: `已从资源查看器定位到「${itemTitle}」。`,
      }),
      noticeTitle: "已回到生成",
      noticeDescription: `正在定位「${itemTitle}」的来源任务。`,
    };
  }

  return null;
}

export function useResourceManagerNavigationIntents({
  onNavigate,
  onHandled,
  onUnsupported,
  storage = typeof window === "undefined" ? null : window.localStorage,
  now = () => Date.now(),
}: UseResourceManagerNavigationIntentsOptions): void {
  const lastHandledIntentIdRef = useRef<string | null>(
    readConsumedResourceManagerNavigationIntentId(storage),
  );

  const handleIntent = useCallback(
    (value: unknown) => {
      const intent = normalizeResourceManagerNavigationIntent(value);
      if (!intent) {
        return;
      }

      if (!isResourceManagerNavigationIntentFresh(intent, now())) {
        return;
      }

      if (lastHandledIntentIdRef.current === intent.id) {
        return;
      }

      const destination = resolveResourceManagerNavigationDestination(intent);
      lastHandledIntentIdRef.current = intent.id;
      markResourceManagerNavigationIntentConsumed(intent, storage);

      if (!destination) {
        onUnsupported?.(intent);
        return;
      }

      onNavigate(destination.page, destination.params);
      void focusMainWindowAfterResourceIntent();
      onHandled?.({ intent, destination });
    },
    [now, onHandled, onNavigate, onUnsupported, storage],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleStoredIntent = (raw: string | null | undefined) => {
      handleIntent(parseResourceManagerNavigationIntent(raw));
    };

    const handleCustomEvent = (event: Event) => {
      if (!(event instanceof CustomEvent)) {
        return;
      }
      handleIntent(event.detail);
    };

    const handleMessage = (event: MessageEvent) => {
      const data = event.data as
        | { type?: unknown; payload?: unknown }
        | null
        | undefined;
      if (data?.type !== RESOURCE_MANAGER_NAVIGATION_INTENT_EVENT) {
        return;
      }
      handleIntent(data.payload);
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== RESOURCE_MANAGER_NAVIGATION_INTENT_KEY) {
        return;
      }
      handleStoredIntent(event.newValue);
    };

    window.addEventListener(
      RESOURCE_MANAGER_NAVIGATION_INTENT_EVENT,
      handleCustomEvent,
    );
    window.addEventListener("message", handleMessage);
    window.addEventListener("storage", handleStorage);

    const initialIntentTimer = window.setTimeout(() => {
      handleIntent(readResourceManagerNavigationIntent(storage));
    }, 0);

    let disposed = false;
    let unlistenTauri: (() => void) | null = null;
    if (hasTauriEventCapability()) {
      void import("@tauri-apps/api/event")
        .then(({ listen }) =>
          listen(RESOURCE_MANAGER_NAVIGATION_INTENT_EVENT, (event) => {
            handleIntent(event.payload);
          }),
        )
        .then((unlisten) => {
          if (disposed) {
            unlisten();
            return;
          }
          unlistenTauri = unlisten;
        })
        .catch(() => {
          // 浏览器模式没有 Tauri 事件能力，保留 window/localStorage 通道即可。
        });
    }

    return () => {
      disposed = true;
      window.clearTimeout(initialIntentTimer);
      unlistenTauri?.();
      window.removeEventListener(
        RESOURCE_MANAGER_NAVIGATION_INTENT_EVENT,
        handleCustomEvent,
      );
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("storage", handleStorage);
    };
  }, [handleIntent, storage]);
}
