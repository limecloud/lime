import { AppServerClient } from "./appServerClient";
import { logAgentDebug } from "@/lib/agentDebug";
import {
  METHOD_SERVER_REQUEST_RESOLVED,
  isThreadSettingsUpdatedNotification,
} from "@limecloud/app-server-client";
import { ThreadSettingsNotificationMirrors } from "./agentRuntime/threadSettingsNotifications";
import {
  isAppServerJsonRpcNotification,
  isAppServerJsonRpcRequest,
} from "./appServerResponse";
import type {
  AppServerDrainEventsRequest,
  AppServerJsonRpcNotification,
  AppServerJsonRpcRequest,
} from "./appServerTypes";

const DEFAULT_APP_SERVER_EVENT_DRAIN_LIMIT = 50;
const DEFAULT_APP_SERVER_EVENT_DRAIN_INTERVAL_MS = 250;
const MAX_RESOLVED_SERVER_REQUEST_TOMBSTONES = 2_048;

type AppServerEventDrainClient = {
  drainEvents: (
    request?: number | AppServerDrainEventsRequest,
  ) => Promise<unknown[]> | unknown[];
};

export interface AppServerEventBusDrainOptions {
  activeIntervalMs?: number;
  includeRecent?: boolean;
  intervalMs?: number;
  limit?: number;
}

export interface AppServerEventBusSubscription {
  getDrainOptions?: () => AppServerEventBusDrainOptions | undefined;
  onError?: (error: unknown) => void;
  onNotifications?: (notifications: AppServerJsonRpcNotification[]) => void;
  onServerRequests?: (requests: AppServerJsonRpcRequest[]) => void;
  shouldDrain?: () => boolean;
}

interface PendingNotificationFlush {
  resolve: () => void;
  reject: (error: unknown) => void;
}

export class AppServerEventBus {
  readonly #appServerClient: AppServerEventDrainClient;
  readonly #completedRecentReplays = new Set<AppServerEventBusSubscription>();
  readonly #pendingServerRequests = new Map<string, AppServerJsonRpcRequest>();
  readonly #resolvedServerRequestIds = new Set<string>();
  readonly #seenServerRequestIds = new Set<string>();
  readonly #subscriptions = new Map<number, AppServerEventBusSubscription>();
  readonly #settingsMirrors = new ThreadSettingsNotificationMirrors();
  readonly #pendingFlushes = new Set<PendingNotificationFlush>();
  #connectionGeneration = 0;
  #draining = false;
  #nextSubscriptionId = 1;

  constructor(
    appServerClient: AppServerEventDrainClient = new AppServerClient(),
  ) {
    this.#appServerClient = appServerClient;
  }

  subscribe(subscription: AppServerEventBusSubscription): () => void {
    if (!subscription.onNotifications && !subscription.onServerRequests) {
      throw new Error(
        "App Server event subscription requires a message handler",
      );
    }
    if (
      subscription.onServerRequests &&
      [...this.#subscriptions.values()].some(
        (existing) => existing.onServerRequests,
      )
    ) {
      throw new Error(
        "App Server event bus already has a server request handler",
      );
    }
    const id = this.#nextSubscriptionId;
    this.#nextSubscriptionId += 1;
    this.#subscriptions.set(id, subscription);
    this.#flushPendingServerRequests(this.#activeSubscriptions());
    this.#startDrainLoop();

    return () => {
      this.#subscriptions.delete(id);
      this.#completedRecentReplays.delete(subscription);
      if (this.#subscriptions.size === 0) this.#finishFlushes();
    };
  }

  /** Deliver queued notifications before a completed streaming request disconnects. */
  flushNotifications(): Promise<void> {
    if (this.#activeSubscriptions().length === 0) return Promise.resolve();
    const promise = new Promise<void>((resolve, reject) => {
      this.#pendingFlushes.add({ resolve, reject });
    });
    this.#startDrainLoop();
    return promise;
  }

  reset(): void {
    this.#connectionGeneration += 1;
    this.#subscriptions.clear();
    this.#completedRecentReplays.clear();
    this.#pendingServerRequests.clear();
    this.#resolvedServerRequestIds.clear();
    this.#seenServerRequestIds.clear();
    this.#settingsMirrors.reset();
    this.#finishFlushes(new Error("App Server notification flush was reset"));
  }

  #finishFlushes(
    error?: unknown,
    flushes: Iterable<PendingNotificationFlush> = this.#pendingFlushes,
  ): void {
    for (const flush of flushes) {
      if (!this.#pendingFlushes.delete(flush)) continue;
      if (error === undefined) flush.resolve();
      else flush.reject(error);
    }
  }

  publishThreadSettingsNotifications(
    notifications: AppServerJsonRpcNotification[],
  ): void {
    this.#dispatchNotifications(
      notifications.filter(isThreadSettingsUpdatedNotification),
      "response",
    );
  }

  #dispatchNotifications(
    notifications: AppServerJsonRpcNotification[],
    source: "response" | "drain",
    subscriptions = this.#activeSubscriptions(),
  ): void {
    const delivered = notifications.filter((notification) =>
      this.#settingsMirrors.accept(notification, source),
    );
    this.#recordResolvedServerRequests(delivered);
    if (delivered.length > 0) {
      for (const subscription of subscriptions) {
        subscription.onNotifications?.(delivered);
      }
    }
  }

  async #drainLoop(): Promise<void> {
    if (this.#draining) {
      return;
    }

    this.#draining = true;
    try {
      while (this.#subscriptions.size > 0) {
        const activeSubscriptions = this.#activeSubscriptions();
        if (activeSubscriptions.length === 0) {
          this.#finishFlushes();
          await waitForAppServerEventDrainInterval(
            DEFAULT_APP_SERVER_EVENT_DRAIN_INTERVAL_MS,
          );
          continue;
        }
        this.#flushPendingServerRequests(activeSubscriptions);

        const drainOptions = resolveDrainOptions(
          activeSubscriptions,
          this.#completedRecentReplays,
        );
        const connectionGeneration = this.#connectionGeneration;
        // A flush cannot be acknowledged by a drain that started before it.
        const pendingFlushes = [...this.#pendingFlushes];
        let hasDrainedMessages = false;
        try {
          const drainRequest =
            drainOptions.includeRecent === true
              ? {
                  includeRecent: true,
                  limit: drainOptions.limit,
                }
              : drainOptions.limit;
          const drainedMessages = await Promise.resolve(
            this.#appServerClient.drainEvents(drainRequest),
          );
          if (connectionGeneration !== this.#connectionGeneration) {
            continue;
          }
          for (const subscription of drainOptions.replayRecentSubscriptions) {
            this.#completedRecentReplays.add(subscription);
          }
          const notifications = readNotifications(drainedMessages);
          const serverRequests = readServerRequests(drainedMessages);
          // Subscriptions can change while the shared transport drain is pending.
          const deliverySubscriptions = this.#activeSubscriptions();
          if (drainedMessages.length > 0) {
            logAgentDebug(
              "AppServerEventBus",
              "drain",
              {
                methods: notifications.map(
                  (notification) => notification.method,
                ),
                notificationCount: notifications.length,
                serverRequestCount: serverRequests.length,
                subscriptionCount: deliverySubscriptions.length,
              },
              { consoleOnly: true },
            );
          }
          hasDrainedMessages =
            notifications.length > 0 || serverRequests.length > 0;
          this.#dispatchNotifications(
            notifications,
            "drain",
            deliverySubscriptions,
          );
          this.#queueServerRequests(serverRequests);
          this.#flushPendingServerRequests(deliverySubscriptions);
          if (drainedMessages.length < drainOptions.limit) {
            this.#finishFlushes(undefined, pendingFlushes);
          }
        } catch (error) {
          if (connectionGeneration !== this.#connectionGeneration) {
            continue;
          }
          logAgentDebug(
            "AppServerEventBus",
            "deliveryFailed",
            { error },
            {
              consoleOnly: true,
              level: "error",
            },
          );
          for (const subscription of activeSubscriptions) {
            subscription.onError?.(error);
          }
          this.#finishFlushes(error, pendingFlushes);
        }

        if (this.#subscriptions.size > 0 && this.#pendingFlushes.size === 0) {
          await waitForAppServerEventDrainInterval(
            this.#resolveNextDrainIntervalMs(hasDrainedMessages),
          );
        }
      }
    } finally {
      this.#draining = false;
      if (this.#subscriptions.size > 0) {
        this.#startDrainLoop();
      }
    }
  }

  #activeSubscriptions(): AppServerEventBusSubscription[] {
    return [...this.#subscriptions.values()].filter(
      (subscription) => subscription.shouldDrain?.() !== false,
    );
  }

  #queueServerRequests(requests: AppServerJsonRpcRequest[]): void {
    for (const request of requests) {
      const requestKey = stableServerRequestKey(
        request.id,
        requestThreadId(request),
      );
      if (this.#seenServerRequestIds.has(requestKey)) {
        continue;
      }
      this.#seenServerRequestIds.add(requestKey);
      if (this.#resolvedServerRequestIds.delete(requestKey)) {
        continue;
      }
      this.#pendingServerRequests.set(requestKey, request);
    }
  }

  #recordResolvedServerRequests(
    notifications: AppServerJsonRpcNotification[],
  ): void {
    for (const notification of notifications) {
      const resolved = readResolvedServerRequest(notification);
      if (!resolved) {
        continue;
      }
      const requestKey = stableServerRequestKey(
        resolved.requestId,
        resolved.threadId,
      );
      if (
        this.#pendingServerRequests.delete(requestKey) ||
        this.#seenServerRequestIds.has(requestKey)
      ) {
        continue;
      }
      rememberBoundedTombstone(
        this.#resolvedServerRequestIds,
        requestKey,
        MAX_RESOLVED_SERVER_REQUEST_TOMBSTONES,
      );
    }
  }

  #flushPendingServerRequests(
    activeSubscriptions: AppServerEventBusSubscription[],
  ): void {
    const handler = activeSubscriptions.find(
      (subscription) => subscription.onServerRequests,
    )?.onServerRequests;
    if (!handler || this.#pendingServerRequests.size === 0) {
      return;
    }
    const requests = [...this.#pendingServerRequests.values()];
    this.#pendingServerRequests.clear();
    handler(requests);
  }

  #startDrainLoop(): void {
    if (!this.#draining) {
      void this.#drainLoop();
    }
  }

  #resolveNextDrainIntervalMs(hasDrainedNotifications: boolean): number {
    const activeSubscriptions = this.#activeSubscriptions();
    if (activeSubscriptions.length === 0) {
      return DEFAULT_APP_SERVER_EVENT_DRAIN_INTERVAL_MS;
    }
    const options = resolveDrainOptions(
      activeSubscriptions,
      this.#completedRecentReplays,
    );
    return hasDrainedNotifications
      ? (options.activeIntervalMs ?? options.intervalMs)
      : options.intervalMs;
  }
}

function stableServerRequestKey(
  id: AppServerJsonRpcRequest["id"],
  threadId: string | null,
): string {
  return JSON.stringify([typeof id, String(id), threadId]);
}

function requestThreadId(request: AppServerJsonRpcRequest): string | null {
  const params =
    request.params &&
    typeof request.params === "object" &&
    !Array.isArray(request.params)
      ? (request.params as Record<string, unknown>)
      : {};
  const threadId = params.threadId;
  return typeof threadId === "string" && threadId.trim()
    ? threadId.trim()
    : null;
}

function rememberBoundedTombstone(
  tombstones: Set<string>,
  requestKey: string,
  limit: number,
): void {
  tombstones.delete(requestKey);
  tombstones.add(requestKey);
  while (tombstones.size > limit) {
    const oldest = tombstones.values().next().value;
    if (oldest === undefined) {
      return;
    }
    tombstones.delete(oldest);
  }
}

let defaultAppServerEventBus: AppServerEventBus | null = null;

function resetDefaultAppServerEventBus(): void {
  defaultAppServerEventBus?.reset();
  defaultAppServerEventBus = null;
}

export function getDefaultAppServerEventBus(
  appServerClient?: AppServerEventDrainClient,
): AppServerEventBus {
  if (!defaultAppServerEventBus) {
    defaultAppServerEventBus = new AppServerEventBus(
      appServerClient ?? new AppServerClient(),
    );
  }
  return defaultAppServerEventBus;
}

export function subscribeAppServerNotifications(
  subscription: AppServerEventBusSubscription,
  options: {
    appServerClient?: AppServerEventDrainClient;
    eventBus?: AppServerEventBus;
  } = {},
): () => void {
  const eventBus =
    options.eventBus ?? getDefaultAppServerEventBus(options.appServerClient);
  return eventBus.subscribe(subscription);
}

export function resetDefaultAppServerEventBusForTests(): void {
  resetDefaultAppServerEventBus();
}

if (import.meta.hot) {
  // Prevent a replaced module instance from consuming events without active subscribers.
  import.meta.hot.dispose(resetDefaultAppServerEventBus);
}

function resolveDrainOptions(
  subscriptions: AppServerEventBusSubscription[],
  completedRecentReplays: ReadonlySet<AppServerEventBusSubscription> = new Set(),
): AppServerEventBusDrainOptions & {
  includeRecent: boolean;
  intervalMs: number;
  limit: number;
  replayRecentSubscriptions: AppServerEventBusSubscription[];
} {
  let hasFastFirstLimit = false;
  let activeIntervalMs: number | undefined;
  let intervalMs = DEFAULT_APP_SERVER_EVENT_DRAIN_INTERVAL_MS;
  let limit: number | undefined;
  const replayRecentSubscriptions: AppServerEventBusSubscription[] = [];

  for (const subscription of subscriptions) {
    const options = subscription.getDrainOptions?.();
    if (
      options?.includeRecent === true &&
      !completedRecentReplays.has(subscription)
    ) {
      replayRecentSubscriptions.push(subscription);
    }
    const nextLimit = normalizePositiveInteger(options?.limit);
    if (nextLimit !== undefined) {
      if (nextLimit <= 1) {
        hasFastFirstLimit = true;
      } else {
        limit = Math.max(limit ?? 0, nextLimit);
      }
    }

    const nextIntervalMs = normalizePositiveInteger(options?.intervalMs);
    if (nextIntervalMs !== undefined) {
      intervalMs = Math.min(intervalMs, nextIntervalMs);
    }

    const nextActiveIntervalMs = normalizePositiveInteger(
      options?.activeIntervalMs,
    );
    if (nextActiveIntervalMs !== undefined) {
      activeIntervalMs = Math.min(
        activeIntervalMs ?? nextActiveIntervalMs,
        nextActiveIntervalMs,
      );
    }
  }

  return {
    activeIntervalMs,
    includeRecent: replayRecentSubscriptions.length > 0,
    intervalMs,
    limit:
      hasFastFirstLimit && replayRecentSubscriptions.length === 0
        ? 1
        : (limit ?? DEFAULT_APP_SERVER_EVENT_DRAIN_LIMIT),
    replayRecentSubscriptions,
  };
}

function readNotifications(
  messages: unknown[] | undefined,
): AppServerJsonRpcNotification[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages.filter(isAppServerJsonRpcNotification);
}

function readServerRequests(
  messages: unknown[] | undefined,
): AppServerJsonRpcRequest[] {
  if (!Array.isArray(messages)) {
    return [];
  }
  return messages.filter(isAppServerJsonRpcRequest);
}

function readResolvedServerRequest(
  notification: AppServerJsonRpcNotification,
): { requestId: AppServerJsonRpcRequest["id"]; threadId: string } | null {
  if (notification.method !== METHOD_SERVER_REQUEST_RESOLVED) {
    return null;
  }
  const params = notification.params;
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return null;
  }
  const record = params as Record<string, unknown>;
  const requestId = record.requestId;
  const threadId = record.threadId;
  if (
    (typeof requestId !== "string" && typeof requestId !== "number") ||
    typeof threadId !== "string" ||
    !threadId.trim()
  ) {
    return null;
  }
  return { requestId, threadId: threadId.trim() };
}

function normalizePositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

async function waitForAppServerEventDrainInterval(
  intervalMs: number,
): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, intervalMs);
    const maybeUnref = (timer as { unref?: () => void } | undefined)?.unref;
    if (maybeUnref) {
      maybeUnref.call(timer);
    }
  });
}
