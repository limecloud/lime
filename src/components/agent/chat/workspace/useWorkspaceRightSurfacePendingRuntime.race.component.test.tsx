import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  WorkspaceRightSurfacePendingChangedSubscription,
  WorkspaceRightSurfacePendingRequest,
} from "@/lib/api/workspaceRightSurface";
import { useWorkspaceRightSurfacePendingRuntime } from "./useWorkspaceRightSurfacePendingRuntime";

type Props = Parameters<typeof useWorkspaceRightSurfacePendingRuntime>[0];
type ListResponse = Awaited<ReturnType<NonNullable<Props["listPending"]>>>;
const cleanup: Array<() => void> = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function request(id = "request", workspaceId = "workspace-a") {
  return {
    requestId: id,
    workspaceId,
    sessionId: "session-a",
    surfaceKind: "browser",
    origin: "user",
    priority: "foreground",
    status: "pending",
    reason: "open_browser_history",
    requestedAt: "2026-10-22T00:00:00.000Z",
    metadata: { browser: { launchUrl: "https://example.com/history" } },
  } satisfies WorkspaceRightSurfacePendingRequest;
}

async function mount(overrides: Partial<Props> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const subscriptions: WorkspaceRightSurfacePendingChangedSubscription[] = [];
  const unsubscribe = vi.fn();
  const listPending = vi.fn<NonNullable<Props["listPending"]>>(async () => ({
    pending: [],
  }));
  let props: Props = {
    enabled: true,
    autoRefreshEnabled: false,
    workspaceId: "workspace-a",
    sessionId: "session-a",
    pollIntervalMs: 0,
    eventDrainIntervalMs: 1_000,
    isBridgeAvailable: () => true,
    listPending,
    subscribePendingChanges: (subscription) => {
      subscriptions.push(subscription);
      return unsubscribe;
    },
    ...overrides,
  };
  let latest!: ReturnType<typeof useWorkspaceRightSurfacePendingRuntime>;
  let mounted = true;
  function Probe(current: Props) {
    latest = useWorkspaceRightSurfacePendingRuntime(current);
    return null;
  }
  const render = async (next: Partial<Props> = {}) => {
    props = { ...props, ...next };
    await act(async () => root.render(<Probe {...props} />));
  };
  const unmount = () => {
    if (!mounted) return;
    act(() => root.unmount());
    container.remove();
    mounted = false;
  };
  cleanup.push(unmount);
  await render();
  return {
    render,
    unmount,
    get: () => latest,
    listPending,
    subscriptions,
    unsubscribe,
  };
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  cleanup.splice(0).forEach((unmount) => unmount());
  vi.restoreAllMocks();
});

describe("Right Surface pending 异步一致性", () => {
  it("历史请求只有 workspaceId 时，root 已就绪仍能由 list 与通知恢复 Browser", async () => {
    const history = { ...request("history"), workspaceRoot: null };
    // 服务端对所有显式过滤做 AND；历史请求没有 root，不能追加 root 过滤。
    const listPending = vi.fn<NonNullable<Props["listPending"]>>(
      async (params) => ({
        pending:
          params.workspaceId === history.workspaceId && !params.workspaceRoot
            ? [history]
            : [],
      }),
    );
    const view = await mount({
      autoRefreshEnabled: true,
      workspaceRoot: "/workspace/project",
      listPending,
    });
    expect(listPending).toHaveBeenCalledWith({
      limit: 50,
      workspaceId: "workspace-a",
    });
    expect(view.get().pendingBrowserIntent?.sourceRequestId).toBe("history");
    const sameWorkspace = { ...history, requestId: "same-workspace" };
    const otherWorkspace = {
      ...history,
      requestId: "other-workspace",
      workspaceId: "workspace-other",
      workspaceRoot: "/workspace/project",
    };
    await act(async () =>
      view.subscriptions[0].onChanges([
        { changeType: "requested", pending: [sameWorkspace, otherWorkspace] },
      ]),
    );
    expect(view.get().pendingRequests).toEqual([history, sameWorkspace]);
  });

  it("换 scope 或禁用后立即隐藏旧 pending 与错误", async () => {
    const view = await mount();
    view.listPending.mockResolvedValueOnce({ pending: [request()] });
    await act(async () => view.get().refreshPendingRequests());
    await view.render({ workspaceId: "workspace-b" });
    expect(view.get().pendingRequests).toEqual([]);
    expect(view.get().pendingBrowserIntent).toBeNull();
    view.listPending.mockRejectedValueOnce(new Error("scope-b failure"));
    await act(async () => view.get().refreshPendingRequests());
    expect(view.get().lastError?.message).toBe("scope-b failure");
    await view.render({ enabled: false });
    expect(view.get().lastError).toBeNull();
  });

  it.each(["success", "failure"] as const)(
    "旧 scope list 的迟到 %s 不覆盖新 scope",
    async (outcome) => {
      const old = deferred<ListResponse>();
      const view = await mount();
      view.listPending.mockReturnValueOnce(old.promise);
      let pending!: Promise<void>;
      await act(async () => {
        pending = view.get().refreshPendingRequests();
      });
      await view.render({ workspaceId: "workspace-b" });
      const next = request("next", "workspace-b");
      view.listPending.mockResolvedValueOnce({ pending: [next] });
      await act(async () => view.get().refreshPendingRequests());
      await act(async () => {
        if (outcome === "success") old.resolve({ pending: [request("old")] });
        else old.reject(new Error("old failure"));
        await pending;
      });
      expect(view.get().pendingRequests).toEqual([next]);
      expect(view.get().lastError).toBeNull();
    },
  );

  it.each(["success", "failure"] as const)(
    "同 scope 最新 list 胜出，忽略较早请求的 %s",
    async (outcome) => {
      const old = deferred<ListResponse>();
      const view = await mount();
      view.listPending.mockReturnValueOnce(old.promise);
      let pending!: Promise<void>;
      await act(async () => {
        pending = view.get().refreshPendingRequests();
      });
      const next = request("newest");
      view.listPending.mockResolvedValueOnce({ pending: [next] });
      await act(async () => view.get().refreshPendingRequests());
      await act(async () => {
        if (outcome === "success") old.resolve({ pending: [request("old")] });
        else old.reject(new Error("old failure"));
        await pending;
      });
      expect(view.get().pendingRequests).toEqual([next]);
      expect(view.get().lastError).toBeNull();
    },
  );

  it("禁用再启用同 scope 后，先前 list 不能复活请求", async () => {
    const old = deferred<ListResponse>();
    const view = await mount();
    view.listPending.mockReturnValueOnce(old.promise);
    let pending!: Promise<void>;
    await act(async () => {
      pending = view.get().refreshPendingRequests();
    });
    await view.render({ enabled: false });
    await view.render({ enabled: true });
    await act(async () => {
      old.resolve({ pending: [request("old")] });
      await pending;
    });
    expect(view.get().pendingRequests).toEqual([]);
  });

  it.each(["requested", "consumed", "dismissed"] as const)(
    "%s 通知之后，之前发起的 list 不能覆盖通知结果",
    async (changeType) => {
      const old = deferred<ListResponse>();
      const view = await mount({ autoRefreshEnabled: true });
      const item = request();
      await act(async () =>
        view.subscriptions[0].onChanges([
          { changeType: "requested", pending: [item] },
        ]),
      );
      view.listPending.mockReturnValueOnce(old.promise);
      let pending!: Promise<void>;
      await act(async () => {
        pending = view.get().refreshPendingRequests();
      });
      const next = request("notification-new");
      await act(async () =>
        view.subscriptions[0].onChanges([
          changeType === "requested"
            ? { changeType, pending: [next] }
            : { changeType, requestIds: [item.requestId] },
        ]),
      );
      const expected = changeType === "requested" ? [item, next] : [];
      expect(view.get().pendingRequests).toEqual(expected);
      await act(async () => {
        old.resolve({ pending: [item] });
        await pending;
      });
      expect(view.get().pendingRequests).toEqual(expected);
    },
  );

  it.each(["scope", "disabled", "unsubscribe"] as const)(
    "%s 失效后旧订阅 callback 不修改状态或错误",
    async (transition) => {
      const view = await mount({ autoRefreshEnabled: true });
      const old = view.subscriptions[0];
      await view.render(
        transition === "scope"
          ? { workspaceId: "workspace-b" }
          : transition === "disabled"
            ? { enabled: false }
            : { autoRefreshEnabled: false },
      );
      expect(view.unsubscribe).toHaveBeenCalled();
      await act(async () => {
        old.onChanges([{ changeType: "requested", pending: [request("old")] }]);
        old.onError?.(new Error("old subscription failure"));
      });
      expect(view.get().pendingRequests).toEqual([]);
      expect(view.get().lastError).toBeNull();
    },
  );

  it.each(["consume", "dismiss"] as const)(
    "%s ACK 之后，之前发起的 list 不能复活旧项，新 list 仍可更新",
    async (action) => {
      const item = request();
      const view = await mount({
        consumePending: async () => ({
          status: "consumed",
          consumedRequestIds: [item.requestId],
          missingRequestIds: [],
        }),
        dismissPending: async () => ({
          status: "dismissed",
          dismissedRequestIds: [item.requestId],
          missingRequestIds: [],
        }),
      });
      view.listPending.mockResolvedValueOnce({ pending: [item] });
      await act(async () => view.get().refreshPendingRequests());
      const old = deferred<ListResponse>();
      view.listPending.mockReturnValueOnce(old.promise);
      let pending!: Promise<void>;
      await act(async () => {
        pending = view.get().refreshPendingRequests();
      });
      await act(async () =>
        action === "consume"
          ? view.get().consumePendingRequestsForSurface("browser")
          : view.get().dismissPendingRequestsForSurface("browser"),
      );
      expect(view.get().pendingRequests).toEqual([]);
      await act(async () => {
        old.resolve({ pending: [item] });
        await pending;
      });
      expect(view.get().pendingRequests).toEqual([]);
      const next = request("new");
      view.listPending.mockResolvedValueOnce({ pending: [next] });
      await act(async () => view.get().refreshPendingRequests());
      expect(view.get().pendingRequests).toEqual([next]);
    },
  );

  for (const action of ["consume", "dismiss"] as const) {
    it.each(["success", "failure"] as const)(
      `换 scope 后旧 ${action} 的 %s 不修改新 scope`,
      async (outcome) => {
        const ack = deferred<{
          status: string;
          consumedRequestIds: string[];
          dismissedRequestIds: string[];
          missingRequestIds: string[];
        }>();
        const view = await mount({
          consumePending: () => ack.promise,
          dismissPending: () => ack.promise,
        });
        view.listPending.mockResolvedValueOnce({ pending: [request()] });
        await act(async () => view.get().refreshPendingRequests());
        let pending!: Promise<void>;
        await act(async () => {
          pending =
            action === "consume"
              ? view.get().consumePendingRequestsForSurface("browser")
              : view.get().dismissPendingRequestsForSurface("browser");
        });
        await view.render({ workspaceId: "workspace-b" });
        const next = request("request", "workspace-b");
        view.listPending.mockResolvedValueOnce({ pending: [next] });
        await act(async () => view.get().refreshPendingRequests());
        await act(async () => {
          if (outcome === "success")
            ack.resolve({
              status: action,
              consumedRequestIds: ["request"],
              dismissedRequestIds: ["request"],
              missingRequestIds: [],
            });
          else ack.reject(new Error("old mutation failure"));
          await pending;
        });
        expect(view.get().pendingRequests).toEqual([next]);
        expect(view.get().lastError).toBeNull();
      },
    );
  }

  it("旧 scope 与卸载后的公开 callback 不再发起 list 或消费", async () => {
    const consumePending = vi.fn(async () => ({
      status: "consumed",
      consumedRequestIds: [],
      missingRequestIds: [],
    }));
    const view = await mount({ consumePending });
    view.listPending.mockResolvedValueOnce({ pending: [request()] });
    await act(async () => view.get().refreshPendingRequests());
    const old = view.get();
    await view.render({ workspaceId: "workspace-b" });
    const listCalls = view.listPending.mock.calls.length;
    await act(async () => {
      await old.refreshPendingRequests();
      await old.consumePendingRequestsForSurface("browser");
    });
    expect(view.listPending).toHaveBeenCalledTimes(listCalls);
    expect(consumePending).not.toHaveBeenCalled();
    const current = view.get();
    view.unmount();
    await current.refreshPendingRequests();
    expect(view.listPending).toHaveBeenCalledTimes(listCalls);
  });

  it("Browser owner 补齐后才投影匹配 session 的待办，workspace 队列保持完整", async () => {
    const foreign = { ...request("foreign"), sessionId: "session-other" };
    const own = { ...request("own"), sessionId: " session-a " };
    const view = await mount({ sessionId: null });
    view.listPending.mockResolvedValueOnce({ pending: [foreign, own] });
    await act(async () => view.get().refreshPendingRequests());
    expect(view.get().pendingRequests).toEqual([foreign, own]);
    expect(view.get().pendingBrowserIntent).toBeNull();
    await view.render({ sessionId: " session-a " });
    expect(view.get().pendingRequests).toEqual([foreign, own]);
    expect(view.get().pendingBrowserIntent?.sourceRequestId).toBe("own");
    expect(view.listPending.mock.calls).toEqual([
      [{ limit: 50, workspaceId: "workspace-a" }],
    ]);
  });

  it.each(["consume", "dismiss"] as const)(
    "Browser %s 只处理当前 session，foreign 待办继续保留",
    async (action) => {
      const consumePending = vi.fn(async () => ({
        status: "consumed",
        consumedRequestIds: ["own"],
        missingRequestIds: [],
      }));
      const dismissPending = vi.fn(async () => ({
        status: "dismissed",
        dismissedRequestIds: ["own"],
        missingRequestIds: [],
      }));
      const foreign = { ...request("foreign"), sessionId: "session-other" };
      const own = request("own");
      const view = await mount({
        sessionId: null,
        consumePending,
        dismissPending,
      });
      view.listPending.mockResolvedValueOnce({ pending: [foreign, own] });
      await act(async () => view.get().refreshPendingRequests());
      const run = () =>
        action === "consume"
          ? view.get().consumePendingRequestsForSurface("browser")
          : view.get().dismissPendingRequestsForSurface("browser");
      await act(async () => run());
      expect(consumePending).not.toHaveBeenCalled();
      expect(dismissPending).not.toHaveBeenCalled();
      await view.render({ sessionId: "session-a" });
      await act(async () => run());
      expect(
        action === "consume" ? consumePending : dismissPending,
      ).toHaveBeenCalledWith({ requestIds: ["own"] });
      expect(view.get().pendingRequests).toEqual([foreign]);
    },
  );

  it("精确 requestIds 只消费当前 session 的指定 pending 交集", async () => {
    const consumePending = vi.fn(async () => ({
      status: "consumed",
      consumedRequestIds: ["first"],
      missingRequestIds: [],
    }));
    const first = request("first");
    const second = request("second");
    const foreign = { ...request("foreign"), sessionId: "session-other" };
    const file = { ...request("file"), surfaceKind: "files" };
    const view = await mount({ consumePending });
    view.listPending.mockResolvedValueOnce({
      pending: [first, second, foreign, file],
    });
    await act(async () => view.get().refreshPendingRequests());
    await act(async () =>
      view.get().consumePendingRequestsForSurface("browser", []),
    );
    expect(consumePending).not.toHaveBeenCalled();
    await act(async () =>
      view
        .get()
        .consumePendingRequestsForSurface("browser", [
          "first",
          "foreign",
          "file",
          "missing",
        ]),
    );
    expect(consumePending).toHaveBeenCalledExactlyOnceWith({
      requestIds: ["first"],
    });
    expect(view.get().pendingRequests).toEqual([second, foreign, file]);
  });

  it("Browser session 规则不改变其他 surface 的 workspace 消费", async () => {
    const consumePending = vi.fn(async () => ({
      status: "consumed",
      consumedRequestIds: ["file"],
      missingRequestIds: [],
    }));
    const file = {
      ...request("file"),
      surfaceKind: "files",
      sessionId: "session-other",
    };
    const view = await mount({ sessionId: null, consumePending });
    view.listPending.mockResolvedValueOnce({ pending: [file] });
    await act(async () => view.get().refreshPendingRequests());
    await act(async () => view.get().consumePendingRequestsForSurface("files"));
    expect(consumePending).toHaveBeenCalledExactlyOnceWith({
      requestIds: ["file"],
    });
    expect(view.get().pendingRequests).toEqual([]);
  });

  it.each(["consume", "dismiss"] as const)(
    "禁用再启用之后，旧 %s ACK 不修改新待办",
    async (action) => {
      const ack = deferred<{
        status: string;
        consumedRequestIds: string[];
        dismissedRequestIds: string[];
        missingRequestIds: string[];
      }>();
      const view = await mount({
        consumePending: () => ack.promise,
        dismissPending: () => ack.promise,
      });
      const item = request();
      view.listPending.mockResolvedValueOnce({ pending: [item] });
      await act(async () => view.get().refreshPendingRequests());
      let pending!: Promise<void>;
      await act(async () => {
        pending =
          action === "consume"
            ? view.get().consumePendingRequestsForSurface("browser")
            : view.get().dismissPendingRequestsForSurface("browser");
      });
      await view.render({ enabled: false });
      await view.render({ enabled: true });
      view.listPending.mockResolvedValueOnce({ pending: [item] });
      await act(async () => view.get().refreshPendingRequests());
      await act(async () => {
        ack.resolve({
          status: action,
          consumedRequestIds: [item.requestId],
          dismissedRequestIds: [item.requestId],
          missingRequestIds: [],
        });
        await pending;
      });
      expect(view.get().pendingRequests).toEqual([item]);
    },
  );

  it("同 workspace 的 Browser session A→B→A 后拒绝旧 A callback 与 ACK", async () => {
    const ack = deferred<{
      status: string;
      consumedRequestIds: string[];
      missingRequestIds: string[];
    }>();
    const consumePending = vi.fn(() => ack.promise);
    const view = await mount({ consumePending });
    const item = request();
    view.listPending.mockResolvedValueOnce({ pending: [item] });
    await act(async () => view.get().refreshPendingRequests());
    const old = view.get().consumePendingRequestsForSurface;
    let pending!: Promise<void>;
    await act(async () => {
      pending = old("browser");
    });
    await view.render({ sessionId: "session-b" });
    expect(view.get().pendingBrowserIntent).toBeNull();
    await view.render({ sessionId: "session-a" });
    await act(async () => {
      await old("browser");
      ack.resolve({
        status: "consumed",
        consumedRequestIds: [item.requestId],
        missingRequestIds: [],
      });
      await pending;
    });
    expect(consumePending).toHaveBeenCalledTimes(1);
    expect(view.get().pendingRequests).toEqual([item]);
    expect(view.get().pendingBrowserIntent?.sourceRequestId).toBe(
      item.requestId,
    );
  });
});
