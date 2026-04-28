import type {
  ResourceManagerItem,
  ResourceManagerKind,
  ResourceManagerSourceContext,
} from "./types";
import { hasTauriEventCapability } from "@/lib/tauri-runtime";
import { normalizeResourceManagerSourceContext } from "./resourceManagerSession";

export const RESOURCE_MANAGER_NAVIGATION_INTENT_KEY =
  "lime:resource-manager:navigation-intent";
export const RESOURCE_MANAGER_NAVIGATION_INTENT_CONSUMED_KEY =
  "lime:resource-manager:navigation-intent:consumed";
export const RESOURCE_MANAGER_NAVIGATION_INTENT_EVENT =
  "lime:resource-manager-navigation-intent";
const RESOURCE_MANAGER_NAVIGATION_INTENT_TTL_MS = 1000 * 60 * 30;

export type ResourceManagerNavigationIntentAction =
  | "locate_chat"
  | "open_project_resource"
  | "continue_image_task";

export interface ResourceManagerNavigationIntent {
  id: string;
  action: ResourceManagerNavigationIntentAction;
  item: {
    id: string;
    kind: ResourceManagerKind;
    title: string;
  };
  sourceContext: ResourceManagerSourceContext;
  createdAt: number;
}

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

function createIntentId(): string {
  const cryptoLike = globalThis.crypto;
  if (typeof cryptoLike?.randomUUID === "function") {
    return `resource-intent-${cryptoLike.randomUUID()}`;
  }

  return `resource-intent-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

function resolveItemTitle(item: ResourceManagerItem): string {
  return (
    item.title?.trim() || item.metadata?.slotLabel?.toString() || "资源预览"
  );
}

function isResourceManagerKind(value: unknown): value is ResourceManagerKind {
  return (
    value === "image" ||
    value === "video" ||
    value === "audio" ||
    value === "pdf" ||
    value === "text" ||
    value === "markdown" ||
    value === "office" ||
    value === "data" ||
    value === "archive" ||
    value === "unknown"
  );
}

function normalizeIntentItem(
  value: unknown,
): ResourceManagerNavigationIntent["item"] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const item = value as Partial<ResourceManagerNavigationIntent["item"]>;
  const id = item.id?.trim();
  const title = item.title?.trim();
  if (!id || !isResourceManagerKind(item.kind)) {
    return null;
  }

  return {
    id,
    kind: item.kind,
    title: title || "资源预览",
  };
}

export function normalizeResourceManagerNavigationIntent(
  value: unknown,
): ResourceManagerNavigationIntent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const intent = value as Partial<ResourceManagerNavigationIntent>;
  const id = intent.id?.trim();
  const item = normalizeIntentItem(intent.item);
  const sourceContext = normalizeResourceManagerSourceContext(
    intent.sourceContext,
  );
  const createdAt =
    typeof intent.createdAt === "number" && Number.isFinite(intent.createdAt)
      ? intent.createdAt
      : 0;

  if (
    !id ||
    !item ||
    !sourceContext ||
    (intent.action !== "locate_chat" &&
      intent.action !== "open_project_resource" &&
      intent.action !== "continue_image_task")
  ) {
    return null;
  }

  return {
    id,
    action: intent.action,
    item,
    sourceContext,
    createdAt,
  };
}

export function parseResourceManagerNavigationIntent(
  raw: string | null | undefined,
): ResourceManagerNavigationIntent | null {
  if (!raw) {
    return null;
  }

  try {
    return normalizeResourceManagerNavigationIntent(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function readResourceManagerNavigationIntent(
  storage: Storage | null | undefined = hasWindow()
    ? window.localStorage
    : undefined,
): ResourceManagerNavigationIntent | null {
  if (!storage) {
    return null;
  }

  try {
    return parseResourceManagerNavigationIntent(
      storage.getItem(RESOURCE_MANAGER_NAVIGATION_INTENT_KEY),
    );
  } catch {
    return null;
  }
}

export function isResourceManagerNavigationIntentFresh(
  intent: ResourceManagerNavigationIntent,
  now = Date.now(),
): boolean {
  return now - intent.createdAt <= RESOURCE_MANAGER_NAVIGATION_INTENT_TTL_MS;
}

export function markResourceManagerNavigationIntentConsumed(
  intent: ResourceManagerNavigationIntent,
  storage: Storage | null | undefined = hasWindow()
    ? window.localStorage
    : undefined,
): void {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(RESOURCE_MANAGER_NAVIGATION_INTENT_CONSUMED_KEY, intent.id);
  } catch {
    // 消费标记只用于防重复；不可写时仍允许本轮导航完成。
  }
}

export function readConsumedResourceManagerNavigationIntentId(
  storage: Storage | null | undefined = hasWindow()
    ? window.localStorage
    : undefined,
): string | null {
  if (!storage) {
    return null;
  }

  try {
    return storage.getItem(RESOURCE_MANAGER_NAVIGATION_INTENT_CONSUMED_KEY);
  } catch {
    return null;
  }
}

function emitTauriResourceManagerNavigationIntent(
  intent: ResourceManagerNavigationIntent,
): void {
  if (!hasTauriEventCapability()) {
    return;
  }

  void import("@tauri-apps/api/event")
    .then(({ emit }) => emit(RESOURCE_MANAGER_NAVIGATION_INTENT_EVENT, intent))
    .catch(() => {
      // Tauri 全局事件是独立窗口间通信增强，失败时仍保留 localStorage / postMessage 路径。
    });
}

export function writeResourceManagerNavigationIntent(params: {
  action: ResourceManagerNavigationIntentAction;
  item: ResourceManagerItem;
  sourceContext: ResourceManagerSourceContext | null | undefined;
}): ResourceManagerNavigationIntent | null {
  if (!hasWindow() || !params.sourceContext) {
    return null;
  }

  const intent: ResourceManagerNavigationIntent = {
    id: createIntentId(),
    action: params.action,
    item: {
      id: params.item.id,
      kind: params.item.kind,
      title: resolveItemTitle(params.item),
    },
    sourceContext: { ...params.sourceContext },
    createdAt: Date.now(),
  };

  try {
    window.localStorage.setItem(
      RESOURCE_MANAGER_NAVIGATION_INTENT_KEY,
      JSON.stringify(intent),
    );
  } catch {
    return null;
  }

  window.dispatchEvent(
    new CustomEvent<ResourceManagerNavigationIntent>(
      RESOURCE_MANAGER_NAVIGATION_INTENT_EVENT,
      { detail: intent },
    ),
  );

  emitTauriResourceManagerNavigationIntent(intent);

  try {
    window.opener?.postMessage(
      {
        type: RESOURCE_MANAGER_NAVIGATION_INTENT_EVENT,
        payload: intent,
      },
      "*",
    );
  } catch {
    // 跨窗口回跳只作为增强能力，不能阻断当前查看器操作。
  }

  return intent;
}
