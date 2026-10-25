/* global NodeJS */
import process from "node:process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AppServerClient,
  decodeMessage,
  encodeMessage,
  type JsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcRequest,
} from "@limecloud/app-server-client";

const {
  fakeConnection,
  fakeSidecarChild,
  createFakeConnected,
  lifecycleConfigs,
  lifecycleInitializeParams,
  lifecycleOptions,
  lifecycleRestarts,
  notificationObservers,
  serverRequestHandlers,
  enqueueFakeNotifications,
  emitFakeNotification,
  recordedRequests,
  releaseDelayedStaleError,
  resetFakeConnection,
  setSystemProxyRules,
  setTurnStartRequestMode,
  waitForDelayedStaleErrorReady,
  FakeAppServerSidecarLifecycle,
  resolveProxyMock,
} = vi.hoisted(() => {
  const recordedRequests: JsonRpcRequest[] = [];
  const lifecycleConfigs: Array<{
    binaryPath: string;
    dataDir?: string;
  }> = [];
  const lifecycleInitializeParams: unknown[] = [];
  const lifecycleRestarts: number[] = [];
  const lifecycleOptions: Array<{
    env?: Record<string, string | undefined>;
    onExit?: (event: {
      attempt: number;
      code: number | null;
      signal: NodeJS.Signals | null;
      stderrLines: string[];
    }) => void;
    onRestarted?: (connected: unknown) => void;
    onRestartFailed?: (event: {
      attempt: number;
      error: unknown;
      stderrLines?: string[];
    }) => void;
  }> = [];
  const mirroredNotifications: JsonRpcMessage[] = [];
  const notificationObservers: Array<
    ((message: JsonRpcNotification) => void) | null
  > = [];
  const serverRequestHandlers: Array<
    ((message: JsonRpcRequest) => Promise<boolean> | boolean) | null
  > = [];
  let notificationObserver: ((message: JsonRpcNotification) => void) | null =
    null;
  const delayedStaleErrorReadyResolvers: Array<() => void> = [];
  let systemProxyRules = "DIRECT";
  const resolveProxyMock = vi.fn(async () => systemProxyRules);
  let releaseDelayedStaleError: (() => void) | null = null;
  let turnStartRequestMode:
    | "resolve"
    | "hang-request"
    | "throw-request-error"
    | "throw-stale-once"
    | "throw-exited-before-next-message"
    | "throw-exited-before-next-message-after-release" = "resolve";
  function waitForDelayedStaleErrorRelease(): Promise<void> {
    delayedStaleErrorReadyResolvers.splice(0).forEach((resolve) => resolve());
    return new Promise((resolve) => {
      releaseDelayedStaleError = resolve;
    });
  }
  function waitForDelayedStaleErrorReady(): Promise<void> {
    if (releaseDelayedStaleError) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      delayedStaleErrorReadyResolvers.push(resolve);
    });
  }
  const fakeConnection = {
    request: vi.fn(async (request: JsonRpcRequest) => {
      if (turnStartRequestMode === "hang-request") {
        recordedRequests.push(request);
        await new Promise(() => undefined);
      }
      if (turnStartRequestMode === "throw-stale-once") {
        turnStartRequestMode = "resolve";
        throw new Error("app-server sidecar stdin is closed");
      }
      if (turnStartRequestMode === "throw-exited-before-next-message") {
        throw new Error(
          "app-server exited before next message: signal=SIGTERM",
        );
      }
      if (
        turnStartRequestMode ===
        "throw-exited-before-next-message-after-release"
      ) {
        await waitForDelayedStaleErrorRelease();
        throw new Error(
          "app-server exited before next message: signal=SIGTERM",
        );
      }
      if (turnStartRequestMode === "throw-request-error") {
        recordedRequests.push(request);
        const { AppServerRequestError } =
          await import("@limecloud/app-server-client");
        const response = {
          id: request.id,
          error: {
            code: -32000,
            message: "MCP current runtime error: fixture failed",
          },
        };
        throw new AppServerRequestError(
          request.method,
          response,
          [],
          [response],
        );
      }
      recordedRequests.push(request);
      const notification = {
        method: "turn/started",
        params: {
          threadId: "thread-b",
          turn: {
            id: "turn-b",
            items: [],
            status: "inProgress",
            startedAt: Date.parse("2026-06-06T00:00:00.000Z") / 1000,
          },
        },
      };
      if (request.method === "turn/start") {
        mirroredNotifications.push(notification);
      }
      return {
        result: {
          ok: true,
        },
        messages: [
          ...(request.method === "turn/start" ? [notification] : []),
          {
            id: request.id,
            result: {
              internalId: request.id,
              method: request.method,
            },
          },
        ],
      };
    }),
    transport: {
      send: vi.fn(),
    },
    respondServerRequest: vi.fn(),
    rejectServerRequest: vi.fn(),
    nextNotification: vi.fn(async () => {
      const notification = mirroredNotifications.shift();
      if (!notification) {
        throw new Error("no notification");
      }
      return notification;
    }),
    nextServerMessage: vi.fn(async (_timeoutMs?: number) => {
      const message = mirroredNotifications.shift();
      if (!message) {
        throw new Error("no server message");
      }
      if ("method" in message && !("id" in message) && notificationObserver) {
        notificationObserver(message as JsonRpcNotification);
      }
      return message;
    }),
    setNotificationObserver: vi.fn(
      (observer: ((message: JsonRpcNotification) => void) | null) => {
        notificationObserver = observer;
        notificationObservers.push(observer);
      },
    ),
    setServerRequestHandler: vi.fn(
      (
        handler:
          | ((message: JsonRpcRequest) => Promise<boolean> | boolean)
          | null,
      ) => {
        serverRequestHandlers.push(handler);
      },
    ),
  };
  const fakeSidecarChild = {
    exitCode: null,
    kill: vi.fn(() => true),
    pid: 4321,
    signalCode: null,
  };
  const createFakeConnected = () => ({
    initializeResponse: {
      serverInfo: {
        name: "app-server",
        version: "0.0.0-test",
        protocolVersion: "appserver.v0",
      },
      platform: {
        family: "desktop",
        os: "macos",
      },
      capabilities: {},
    },
    connection: fakeConnection,
    client: new AppServerClient(),
    sidecar: { child: fakeSidecarChild },
  });

  function enqueueFakeNotifications(notifications: JsonRpcMessage[]): void {
    mirroredNotifications.push(...notifications);
  }

  function emitFakeNotification(message: JsonRpcMessage): void {
    if ("method" in message && !("id" in message) && notificationObserver) {
      notificationObserver(message as JsonRpcNotification);
    }
  }

  class FakeAppServerSidecarLifecycle {
    connected:
      | {
          initializeResponse: {
            serverInfo: {
              name: string;
              version: string;
              protocolVersion: string;
            };
            platform: {
              family: string;
              os: string;
            };
            capabilities: Record<string, unknown>;
          };
          connection: typeof fakeConnection;
          sidecar: { child: typeof fakeSidecarChild };
        }
      | undefined;

    constructor(
      config: {
        binaryPath: string;
        dataDir?: string;
      },
      initializeParams: unknown,
      options: (typeof lifecycleOptions)[number] = {},
    ) {
      lifecycleConfigs.push(config);
      lifecycleInitializeParams.push(initializeParams);
      lifecycleOptions.push(options);
    }

    async start() {
      this.connected = createFakeConnected();
      return this.connected;
    }

    async stop() {
      this.connected = undefined;
      return undefined;
    }

    async restart() {
      lifecycleRestarts.push(lifecycleRestarts.length + 1);
      this.connected = createFakeConnected();
      return this.connected;
    }
  }

  return {
    fakeConnection,
    fakeSidecarChild,
    createFakeConnected,
    lifecycleConfigs,
    lifecycleInitializeParams,
    lifecycleOptions,
    lifecycleRestarts,
    notificationObservers,
    serverRequestHandlers,
    enqueueFakeNotifications,
    emitFakeNotification,
    recordedRequests,
    resetFakeConnection: () => {
      recordedRequests.length = 0;
      lifecycleConfigs.length = 0;
      lifecycleInitializeParams.length = 0;
      lifecycleOptions.length = 0;
      lifecycleRestarts.length = 0;
      mirroredNotifications.length = 0;
      notificationObservers.length = 0;
      serverRequestHandlers.length = 0;
      delayedStaleErrorReadyResolvers.length = 0;
      systemProxyRules = "DIRECT";
      resolveProxyMock.mockClear();
      releaseDelayedStaleError = null;
      turnStartRequestMode = "resolve";
      fakeConnection.request.mockClear();
      fakeConnection.transport.send.mockClear();
      fakeConnection.respondServerRequest.mockClear();
      fakeConnection.rejectServerRequest.mockClear();
      fakeConnection.nextNotification.mockClear();
      fakeConnection.nextServerMessage.mockClear();
      fakeConnection.setNotificationObserver.mockClear();
      fakeConnection.setServerRequestHandler.mockClear();
      notificationObserver = null;
      fakeSidecarChild.kill.mockClear();
    },
    setSystemProxyRules: (rules: string) => {
      systemProxyRules = rules;
    },
    setTurnStartRequestMode: (
      mode:
        | "resolve"
        | "hang-request"
        | "throw-request-error"
        | "throw-stale-once"
        | "throw-exited-before-next-message"
        | "throw-exited-before-next-message-after-release",
    ) => {
      turnStartRequestMode = mode;
    },
    waitForDelayedStaleErrorReady,
    releaseDelayedStaleError: () => {
      releaseDelayedStaleError?.();
    },
    FakeAppServerSidecarLifecycle,
    resolveProxyMock,
  };
});

vi.mock("./electronRuntime", () => ({
  app: {
    getAppPath: () => process.cwd(),
    getPath: (name: string) =>
      name === "userData" ? "/tmp/lime-electron-user-data" : "/tmp/lime",
    getLocale: () => "en-US",
    getName: () => "Lime",
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
  session: {
    defaultSession: {
      resolveProxy: resolveProxyMock,
    },
  },
}));

Object.defineProperty(process, "resourcesPath", {
  configurable: true,
  value: process.cwd(),
});

const originalPlatform = process.platform;
const proxyEnvKeys = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
] as const;
const runtimeLibraryEnvKeys = [
  "DYLD_FALLBACK_LIBRARY_PATH",
  "DYLD_LIBRARY_PATH",
  "LD_LIBRARY_PATH",
  "LIME_CONFIG_PATH",
] as const;

function setProcessPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: platform,
  });
}

vi.mock("@limecloud/app-server-client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@limecloud/app-server-client")>();
  return {
    ...actual,
    AppServerSidecarLifecycle: FakeAppServerSidecarLifecycle,
    defaultReleaseManifestPath: vi.fn(
      (resourcesPath: string) => `${resourcesPath}/app-server-release.json`,
    ),
    readReleaseManifest: vi.fn(async () => {
      throw new Error("no packaged manifest");
    }),
    resolveSidecarFromReleaseManifest: vi.fn(() => null),
    stdioSidecar: vi.fn(
      (binaryPath: string, appPolicyPath?: string, dataDir?: string) => ({
        binaryPath,
        ...(appPolicyPath ? { appPolicyPath } : {}),
        ...(dataDir ? { dataDir } : {}),
      }),
    ),
  };
});

function agentSessionEventMessage(options: {
  eventId: string;
  sequence: number;
  type: string;
}): JsonRpcMessage {
  return {
    method: "agentSession/event",
    params: {
      event: {
        eventId: options.eventId,
        sequence: options.sequence,
        sessionId: "session-b",
        turnId: "turn-b",
        type: options.type,
        timestamp: "2026-06-06T00:00:00.000Z",
        payload: {},
      },
    },
  };
}

describe("ElectronAppServerHost", () => {
  beforeEach(() => {
    resetFakeConnection();
    delete process.env.LIME_AGENT_RUNTIME_ROOT;
    delete process.env.LIME_ELECTRON_E2E;
    delete process.env.ELECTRON_E2E_USER_DATA_DIR;
    for (const key of proxyEnvKeys) {
      delete process.env[key];
    }
    for (const key of runtimeLibraryEnvKeys) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    setProcessPlatform(originalPlatform);
    delete process.env.LIME_AGENT_RUNTIME_ROOT;
    delete process.env.LIME_ELECTRON_E2E;
    delete process.env.ELECTRON_E2E_USER_DATA_DIR;
    for (const key of proxyEnvKeys) {
      delete process.env[key];
    }
    for (const key of runtimeLibraryEnvKeys) {
      delete process.env[key];
    }
  });

  it("Desktop 偏好经过初始化和两种配置写入入口回读，停止时隔离迟到读取", async () => {
    const { ElectronAppServerHost } = await import("./appServerHost");
    const { DesktopPreferencesHost } = await import("./desktopPreferencesHost");
    const apply = vi.fn();
    let enabled = true;
    let delayRead = false;
    let release!: () => void;
    const delayedRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markReadReady!: () => void;
    const readReady = new Promise<void>((resolve) => {
      markReadReady = resolve;
    });
    const preferences = new DesktopPreferencesHost({
      platform: "darwin",
      request: async <T>(method: string, params: unknown) => {
        await host.request(method, params);
        if (delayRead) {
          markReadReady();
          await delayedRead;
        }
        return {
          config: { desktop: { "mac-menu-bar-enabled": enabled } },
        } as T;
      },
      setMacMenuBarEnabled: apply,
    });
    const host: InstanceType<typeof ElectronAppServerHost> =
      new ElectronAppServerHost(null, preferences);
    await host.warmup();
    expect(apply.mock.calls).toEqual([[true]]);
    enabled = false;
    await host.request("config/batchWrite", { edits: [] });
    expect(apply.mock.calls).toEqual([[true], [false]]);
    enabled = true;
    const result = await host.handleJsonLines({
      lines: [
        encodeMessage({
          id: 42,
          method: "config/value/write",
          params: {
            keyPath: "desktop.mac-menu-bar-enabled",
            value: true,
            mergeStrategy: "replace",
          },
        }),
      ],
    });
    expect(result.lines.map(decodeMessage)).toContainEqual(
      expect.objectContaining({ id: 42 }),
    );
    expect(apply.mock.calls).toEqual([[true], [false], [true]]);
    expect(
      recordedRequests.filter((request) => request.method === "config/read"),
    ).toHaveLength(3);
    delayRead = true;
    const pending = preferences.refresh();
    await readReady;
    await host.stop();
    release();
    await pending;
    expect(apply.mock.calls).toEqual([[true], [false], [true]]);
  });

  it("真实Host委托canonical活动和断线，旧连接通知不能重新申请电源资源", async () => {
    const { ElectronAppServerHost } = await import("./appServerHost");
    const { DesktopPreferencesHost } = await import("./desktopPreferencesHost");
    const { PowerSaveHost } = await import("./powerSaveHost");
    const start = vi.fn(() => 9);
    const stop = vi.fn();
    const preferences = new DesktopPreferencesHost({
      platform: "darwin",
      request: async <T>() =>
        ({ config: { desktop: { preventSleepWhileRunning: true } } }) as T,
      setMacMenuBarEnabled: vi.fn(),
      powerSaveHost: new PowerSaveHost({ platform: "darwin", start, stop }),
    });
    const host = new ElectronAppServerHost(null, preferences);
    const startSidecar = vi.spyOn(
      FakeAppServerSidecarLifecycle.prototype,
      "start",
    );
    await host.warmup();
    const notification: JsonRpcNotification = {
      method: "thread/status/changed",
      params: {
        threadId: "power-thread",
        status: { type: "active", activeFlags: [] },
      },
    };
    emitFakeNotification(notification);
    expect(start).toHaveBeenCalledExactlyOnceWith("prevent-app-suspension");
    const stale = notificationObservers.at(-1)!;
    type ReadResult = Awaited<ReturnType<typeof fakeConnection.request>>;
    let releaseRead!: (value: ReadResult) => void;
    fakeConnection.request.mockImplementationOnce(
      async () =>
        await new Promise<ReadResult>((resolve) => {
          releaseRead = resolve;
        }),
    );
    const lateRead = host.request("thread/read", { threadId: "power-thread" });
    await vi.waitFor(() => expect(releaseRead).toBeTypeOf("function"));
    lifecycleOptions.at(-1)!.onExit!({
      attempt: 1,
      code: 1,
      signal: null,
      stderrLines: [],
    });
    expect(stop).toHaveBeenCalledExactlyOnceWith(9);
    stale(notification);
    expect(start).toHaveBeenCalledTimes(1);
    const lateResult = {
      result: {
        ok: true,
        thread: { id: "power-thread", status: { type: "active" } },
      },
      messages: [],
    };
    releaseRead(lateResult);
    await lateRead;
    expect(start).toHaveBeenCalledTimes(1);
    const restarted = createFakeConnected();
    const lifecycle = startSidecar.mock.contexts[0] as InstanceType<
      typeof FakeAppServerSidecarLifecycle
    >;
    lifecycle.connected = restarted;
    lifecycleOptions.at(-1)!.onRestarted!(restarted);
    emitFakeNotification(notification);
    expect(start).toHaveBeenCalledTimes(2);
    await host.stop();
    expect(stop).toHaveBeenCalledTimes(2);
    emitFakeNotification(notification);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it.each(["request", "json-lines"])(
    "%s入口将turn/start回执和原threadId投影到电源资源",
    async (entry) => {
      const { ElectronAppServerHost } = await import("./appServerHost");
      const { DesktopPreferencesHost } =
        await import("./desktopPreferencesHost");
      const { PowerSaveHost } = await import("./powerSaveHost");
      const start = vi.fn(() => 9);
      const stop = vi.fn();
      const preferences = new DesktopPreferencesHost({
        platform: "darwin",
        request: async <T>() =>
          ({ config: { desktop: { preventSleepWhileRunning: true } } }) as T,
        setMacMenuBarEnabled: vi.fn(),
        powerSaveHost: new PowerSaveHost({ platform: "darwin", start, stop }),
      });
      const host = new ElectronAppServerHost(null, preferences);
      await host.warmup();
      fakeConnection.request.mockImplementationOnce(async (request) => {
        const result = {
          ok: true,
          internalId: request.id,
          method: request.method,
          turn: { id: "power-turn", status: "inProgress" },
        };
        return { result, messages: [{ id: request.id, result }] };
      });
      const params = { threadId: "power-thread", input: [] };
      if (entry === "request") await host.request("turn/start", params);
      else
        await host.handleJsonLines({
          lines: [encodeMessage({ id: 42, method: "turn/start", params })],
        });
      expect(start).toHaveBeenCalledExactlyOnceWith("prevent-app-suspension");
      emitFakeNotification({
        method: "turn/completed",
        params: {
          threadId: "power-thread",
          turn: { id: "power-turn", status: "completed" },
        },
      });
      expect(stop).toHaveBeenCalledExactlyOnceWith(9);
      await host.stop();
    },
  );

  it("启动 App Server 时应显式传入 Electron userData 下的 dataDir", async () => {
    const { ElectronAppServerHost } = await import("./appServerHost");
    const host = new ElectronAppServerHost();

    await host.warmup();

    expect(lifecycleConfigs).toHaveLength(1);
    expect(lifecycleConfigs[0]).toMatchObject({
      dataDir: "/tmp/lime-electron-user-data/app-server",
    });
    expect(lifecycleOptions[0]?.env?.LIME_AGENT_RUNTIME_ROOT).toBe(
      "/tmp/lime-electron-user-data/app-server",
    );
    expect(lifecycleOptions[0]?.env?.APP_SERVER_APP_DATA_DIR).toBe(
      "/tmp/lime-electron-user-data",
    );
    expect(lifecycleInitializeParams[0]).toMatchObject({
      capabilities: {
        eventMethods: expect.arrayContaining([
          "thread/started",
          "thread/status/changed",
          "thread/closed",
          "turn/started",
          "turn/completed",
          "item/started",
          "item/completed",
          "item/mcpToolCall/progress",
          "item/agentMessage/delta",
          "model/list/updated",
          "thread/tokenUsage/updated",
        ]),
      },
    });
  });

  it("只允许 E2E 模式终止当前 App Server sidecar", async () => {
    const { ElectronAppServerHost } = await import("./appServerHost");
    const host = new ElectronAppServerHost();
    await host.warmup();

    expect(() => host.terminateSidecarForE2e()).toThrow(
      "App Server sidecar termination is only available in E2E mode",
    );
    expect(fakeSidecarChild.kill).not.toHaveBeenCalled();

    process.env.LIME_ELECTRON_E2E = "1";
    expect(host.terminateSidecarForE2e()).toEqual({
      pid: 4321,
      requested: true,
      signal: "SIGTERM",
    });
    expect(fakeSidecarChild.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("sidecar 断连期间 drain 应等待当前 lifecycle 重启", async () => {
    const { ElectronAppServerHost } = await import("./appServerHost");
    const host = new ElectronAppServerHost();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await host.warmup();

    lifecycleOptions[0].onExit?.({
      attempt: 1,
      code: null,
      signal: "SIGTERM",
      stderrLines: [],
    });
    const drain = host.drainEvents();
    await expect(
      Promise.race([drain.then(() => "resolved"), Promise.resolve("pending")]),
    ).resolves.toBe("pending");
    expect(lifecycleConfigs).toHaveLength(1);

    lifecycleOptions[0].onRestarted?.(createFakeConnected());
    await expect(drain).resolves.toEqual({ lines: [] });
    expect(lifecycleConfigs).toHaveLength(1);
    warnSpy.mockRestore();
  });

  it("系统恢复时只执行一次重连，并拒绝旧连接的通知回写", async () => {
    const { ElectronAppServerHost } = await import("./appServerHost");
    const host = new ElectronAppServerHost();
    await host.warmup();

    const oldObserver = notificationObservers[0];
    const firstRecovery = host.recoverAfterSystemResume();
    const secondRecovery = host.recoverAfterSystemResume();
    await Promise.all([firstRecovery, secondRecovery]);

    expect(lifecycleRestarts).toEqual([1]);
    expect(notificationObservers).toHaveLength(2);
    expect(serverRequestHandlers).toHaveLength(2);

    await expect(
      serverRequestHandlers[0]?.({
        id: "stale-request",
        method: "item/tool/requestUserInput",
        params: {},
      }),
    ).resolves.toBe(false);

    oldObserver?.({
      method: "stale/notification",
      params: { source: "old-connection" },
    });
    notificationObservers[1]?.({
      method: "current/notification",
      params: { source: "new-connection" },
    });

    const replayed = await host.drainEvents({
      includeRecent: true,
      limit: 10,
    });
    const methods = replayed.lines
      .map((line) => decodeMessage(line))
      .map((message) => ("method" in message ? message.method : ""));
    expect(methods).toEqual(["current/notification"]);
  });

  it("Desktop Host 诊断应包含连接代际并脱敏 sidecar 失败上下文", async () => {
    const { ElectronAppServerHost } = await import("./appServerHost");
    const host = new ElectronAppServerHost();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      expect(host.getDiagnostics()).toMatchObject({
        schema_version: 1,
        stage: "idle",
        connected: false,
        connection_generation: 0,
        sidecar: null,
      });

      await host.warmup();
      expect(host.getDiagnostics()).toMatchObject({
        stage: "ready",
        connected: true,
        connection_generation: 1,
        sidecar: {
          pid: 4321,
          running: true,
        },
      });

      lifecycleOptions[0].onExit?.({
        attempt: 1,
        code: 17,
        signal: null,
        stderrLines: [
          "token=super-secret-123456 /Users/coso/private/config.yaml",
          ...Array.from({ length: 25 }, (_, index) => `line-${index}`),
        ],
      });

      const diagnostics = host.getDiagnostics();
      expect(diagnostics).toMatchObject({
        stage: "restarting",
        connected: false,
        connection_generation: 1,
        sidecar: null,
        last_failure: {
          stage: "restarting",
          exit_code: 17,
          signal: null,
        },
      });
      expect(diagnostics.last_failure?.stderr_tail).toHaveLength(20);
      expect(diagnostics.last_failure?.stderr_tail.join("\n")).not.toContain(
        "super-secret-123456",
      );
      expect(diagnostics.last_failure?.stderr_tail.join("\n")).not.toContain(
        "/Users/coso",
      );
      const [, loggedFailure] = warnSpy.mock.calls.at(-1) ?? [];
      expect(loggedFailure).toMatchObject({
        attempt: 1,
        exit_code: 17,
        stderr_tail: expect.any(Array),
      });
      expect(JSON.stringify(loggedFailure)).not.toContain(
        "super-secret-123456",
      );
      expect(JSON.stringify(loggedFailure)).not.toContain("/Users/coso");

      lifecycleOptions[0].onRestartFailed?.({
        attempt: 2,
        error: new Error(
          "Bearer restart-secret-123456 /private/tmp/restart-config.yaml",
        ),
        stderrLines: ["api_key=restart-secret-123456"],
      });
      const [, loggedRestartFailure] = warnSpy.mock.calls.at(-1) ?? [];
      expect(JSON.stringify(loggedRestartFailure)).not.toContain(
        "restart-secret-123456",
      );
      expect(JSON.stringify(loggedRestartFailure)).not.toContain(
        "/private/tmp",
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("系统恢复期间已有自动重启时应等待原有 waiter，不能重复拉起 sidecar", async () => {
    const { ElectronAppServerHost } = await import("./appServerHost");
    const host = new ElectronAppServerHost();
    await host.warmup();

    lifecycleOptions[0].onExit?.({
      attempt: 1,
      code: null,
      signal: "SIGTERM",
      stderrLines: [],
    });
    const recovery = host.recoverAfterSystemResume();
    await expect(
      Promise.race([
        recovery.then(() => "resolved"),
        Promise.resolve("pending"),
      ]),
    ).resolves.toBe("pending");
    expect(lifecycleRestarts).toEqual([]);

    lifecycleOptions[0].onRestarted?.(createFakeConnected());
    await recovery;
    expect(lifecycleRestarts).toEqual([]);
  });

  it("显式 AgentRoot override 时 App Server 不再写默认 userData root", async () => {
    process.env.LIME_AGENT_RUNTIME_ROOT = "/tmp/lime-agent-runtime";
    const { ElectronAppServerHost } = await import("./appServerHost");
    const host = new ElectronAppServerHost();

    await host.warmup();

    expect(lifecycleConfigs[0]?.dataDir).toBe("/tmp/lime-agent-runtime");
    expect(lifecycleOptions[0]?.env?.LIME_AGENT_RUNTIME_ROOT).toBe(
      "/tmp/lime-agent-runtime",
    );
    expect(lifecycleOptions[0]?.env?.APP_SERVER_APP_DATA_DIR).toBe(
      "/tmp/lime-electron-user-data",
    );
  });

  it("Windows E2E 隔离 root 压过 ambient AgentRoot 和真实 LOCALAPPDATA", async () => {
    setProcessPlatform("win32");
    process.env.LIME_ELECTRON_E2E = "1";
    process.env.ELECTRON_E2E_USER_DATA_DIR = "C:\\Temp\\lime-e2e-user-data";
    process.env.LOCALAPPDATA = "C:\\Users\\test\\AppData\\Local";
    process.env.LIME_AGENT_RUNTIME_ROOT =
      "C:\\Users\\test\\AppData\\Local\\real-agent-root";
    const { ElectronAppServerHost } = await import("./appServerHost");
    const host = new ElectronAppServerHost();

    await host.warmup();

    expect(lifecycleConfigs[0]?.dataDir).toBe(
      "C:\\Temp\\lime-e2e-user-data\\app-server",
    );
    expect(lifecycleOptions[0]?.env?.LIME_AGENT_RUNTIME_ROOT).toBe(
      "C:\\Temp\\lime-e2e-user-data\\app-server",
    );
    expect(lifecycleOptions[0]?.env?.APP_SERVER_APP_DATA_DIR).toBe(
      "C:\\Temp\\lime-e2e-user-data",
    );
  });

  it("启动 App Server 时应把配置事实源收敛到 Electron userData config.yaml", async () => {
    process.env.LIME_CONFIG_PATH = "/tmp/legacy-global-config.yaml";
    const { ElectronAppServerHost } = await import("./appServerHost");
    const host = new ElectronAppServerHost();

    await host.warmup();

    expect(lifecycleOptions).toHaveLength(1);
    expect(lifecycleOptions[0].env?.LIME_CONFIG_PATH).toBe(
      "/tmp/lime-electron-user-data/config.yaml",
    );
  });

  it("macOS 启动 App Server 时应把可执行文件目录放入动态库搜索路径", async () => {
    setProcessPlatform("darwin");
    process.env.DYLD_LIBRARY_PATH = "/existing/dyld";
    process.env.DYLD_FALLBACK_LIBRARY_PATH = "/existing/fallback";
    const { ElectronAppServerHost } = await import("./appServerHost");
    const host = new ElectronAppServerHost();

    await host.warmup();

    const binaryDir = lifecycleConfigs[0].binaryPath.replace(
      /\/app-server$/u,
      "",
    );
    expect(lifecycleOptions).toHaveLength(1);
    expect(lifecycleOptions[0].env?.DYLD_LIBRARY_PATH?.split(":")).toEqual([
      binaryDir,
      "/existing/dyld",
    ]);
    expect(
      lifecycleOptions[0].env?.DYLD_FALLBACK_LIBRARY_PATH?.split(":"),
    ).toEqual([binaryDir, "/existing/fallback"]);
  });

  it("macOS 系统代理存在时应传给 App Server sidecar", async () => {
    setProcessPlatform("darwin");
    setSystemProxyRules("PROXY 127.0.0.1:7890; DIRECT");
    const { ElectronAppServerHost } = await import("./appServerHost");
    const host = new ElectronAppServerHost();

    await host.warmup();

    expect(lifecycleOptions).toHaveLength(1);
    expect(lifecycleOptions[0].env).toMatchObject({
      HTTP_PROXY: "http://127.0.0.1:7890",
      HTTPS_PROXY: "http://127.0.0.1:7890",
      ALL_PROXY: "http://127.0.0.1:7890",
      http_proxy: "http://127.0.0.1:7890",
      https_proxy: "http://127.0.0.1:7890",
      all_proxy: "http://127.0.0.1:7890",
    });
    expect(lifecycleOptions[0].env?.NO_PROXY).toContain("127.0.0.1");
    expect(lifecycleOptions[0].env?.NO_PROXY).toContain("localhost");
    expect(lifecycleOptions[0].env?.NO_PROXY).toContain("::1");
  });

  it("显式代理环境变量存在时不应被系统代理覆盖", async () => {
    setProcessPlatform("darwin");
    process.env.HTTPS_PROXY = "http://explicit.proxy:8080";
    setSystemProxyRules("PROXY 127.0.0.1:7890; DIRECT");
    const { ElectronAppServerHost } = await import("./appServerHost");
    const host = new ElectronAppServerHost();

    await host.warmup();

    expect(lifecycleOptions).toHaveLength(1);
    expect(lifecycleOptions[0].env?.HTTPS_PROXY).toBeUndefined();
    expect(lifecycleOptions[0].env?.NO_PROXY).toContain("127.0.0.1");
  });

  it("转发 JSON-RPC 时隔离并发前端 request id，并在返回前还原原 id", async () => {
    const { ElectronAppServerHost } = await import("./appServerHost");
    const host = new ElectronAppServerHost();

    const first = host.handleJsonLines({
      lines: [
        encodeMessage({
          id: 1,
          method: "thread/read",
          params: { threadId: "thread-a" },
        }),
      ],
    });
    const second = host.handleJsonLines({
      lines: [
        encodeMessage({
          id: 1,
          method: "turn/start",
          params: {
            threadId: "thread-b",
            input: [{ type: "text", text: "并发 turn" }],
          },
        }),
      ],
    });

    const [firstResult, secondResult] = await Promise.all([first, second]);
    const firstMessages = firstResult.lines.map(decodeMessage);
    const secondMessages = secondResult.lines.map(decodeMessage);
    const firstMessage = firstMessages.find((message) => "id" in message);
    const secondMessage = secondMessages.find((message) => "id" in message);

    expect(recordedRequests).toHaveLength(2);
    expect(recordedRequests[0]?.id).not.toBe(recordedRequests[1]?.id);
    expect(recordedRequests.map((request) => request.id)).toEqual([
      "electron-host:1",
      "electron-host:2",
    ]);
    expect(firstMessage).toMatchObject({
      id: 1,
      result: {
        internalId: "electron-host:1",
        method: "thread/read",
      },
    });
    expect(secondMessage).toMatchObject({
      id: 1,
      result: {
        internalId: "electron-host:2",
        method: "turn/start",
      },
    });
  });

  it("handleJsonLines 应把 App Server 业务错误保留为 JSON-RPC error response", async () => {
    const { ElectronAppServerHost } = await import("./appServerHost");
    const host = new ElectronAppServerHost();
    setTurnStartRequestMode("throw-request-error");

    const result = await host.handleJsonLines({
      lines: [
        encodeMessage({
          id: "renderer-request-1",
          method: "mcpServer/start",
          params: { name: "broken-server" },
        }),
      ],
    });

    expect(recordedRequests).toHaveLength(1);
    expect(recordedRequests[0]?.id).toBe("electron-host:1");
    expect(result.lines.map(decodeMessage)).toEqual([
      {
        id: "renderer-request-1",
        error: {
          code: -32000,
          message: "MCP current runtime error: fixture failed",
        },
      },
    ]);
  });

  it("取消 JSON-RPC request 时应把 renderer id 映射成 sidecar 内部 id", async () => {
    const { ElectronAppServerHost } = await import("./appServerHost");
    const host = new ElectronAppServerHost();
    setTurnStartRequestMode("hang-request");

    const pending = host.handleJsonLines({
      lines: [
        encodeMessage({
          id: 7,
          method: "thread/read",
          params: { threadId: "thread-cancel" },
        }),
      ],
    });
    await vi.waitFor(() => {
      expect(recordedRequests).toHaveLength(1);
    });

    await host.handleJsonLines({
      lines: [
        encodeMessage({
          method: "$/cancelRequest",
          params: { id: 7 },
        }),
      ],
    });

    expect(fakeConnection.transport.send).toHaveBeenCalledWith({
      method: "$/cancelRequest",
      params: { id: "electron-host:1" },
    });
    await expect(
      Promise.race([pending, Promise.resolve("still-pending")]),
    ).resolves.toBe("still-pending");
  });

  it("发现 stale sidecar stdin 已关闭时应丢弃旧连接并重启后重试当前请求", async () => {
    const { ElectronAppServerHost } = await import("./appServerHost");
    const host = new ElectronAppServerHost();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    setTurnStartRequestMode("throw-stale-once");

    try {
      const result = await host.handleJsonLines({
        lines: [
          encodeMessage({
            id: 1,
            method: "thread/read",
            params: { threadId: "thread-stale" },
          }),
        ],
      });
      const messages = result.lines.map(decodeMessage);

      expect(lifecycleConfigs).toHaveLength(2);
      expect(fakeConnection.request).toHaveBeenCalledTimes(2);
      expect(recordedRequests).toHaveLength(1);
      expect(recordedRequests[0]).toMatchObject({
        id: "electron-host:1",
        method: "thread/read",
      });
      expect(messages).toEqual([
        {
          id: 1,
          result: {
            internalId: "electron-host:1",
            method: "thread/read",
          },
        },
      ]);
      expect(warnSpy).toHaveBeenCalledWith(
        "[electron-host] app-server stale connection detected; restarting sidecar",
        expect.any(Error),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("停止期间遇到 sidecar 退出等待错误时不应重启 App Server", async () => {
    const { ElectronAppServerHost } = await import("./appServerHost");
    const host = new ElectronAppServerHost();

    await host.warmup();
    setTurnStartRequestMode("throw-exited-before-next-message-after-release");
    const request = host.handleJsonLines({
      lines: [
        encodeMessage({
          id: 1,
          method: "thread/read",
          params: { threadId: "thread-closing" },
        }),
      ],
    });
    await waitForDelayedStaleErrorReady();
    await host.stop();
    releaseDelayedStaleError();

    await expect(request).rejects.toThrow("app-server host is stopping");
    expect(lifecycleConfigs).toHaveLength(1);
    expect(fakeConnection.request).toHaveBeenCalledTimes(1);
    expect(recordedRequests).toHaveLength(0);
  });

  it("drainEvents 应能读取 turn/start 请求镜像的 direct notification", async () => {
    const { ElectronAppServerHost } = await import("./appServerHost");
    const host = new ElectronAppServerHost();

    await host.handleJsonLines({
      lines: [
        encodeMessage({
          id: 1,
          method: "turn/start",
          params: {
            threadId: "thread-b",
            input: [{ type: "text", text: "生成草稿" }],
          },
        }),
      ],
    });

    const drained = await host.drainEvents({ limit: 1 });
    const message = decodeMessage(drained.lines[0] ?? "");

    expect(message).toMatchObject({
      method: "turn/started",
      params: {
        threadId: "thread-b",
        turn: {
          id: "turn-b",
          status: "inProgress",
        },
      },
    });
    expect(fakeConnection.nextServerMessage).toHaveBeenCalled();
  });

  it("warmup 后应保留 initialize 阶段已缓冲的 configWarning", async () => {
    const { ElectronAppServerHost } = await import("./appServerHost");
    const host = new ElectronAppServerHost();
    enqueueFakeNotifications([
      {
        method: "configWarning",
        params: {
          summary: "test initialize config warning",
          path: "/tmp/lime/config.yaml",
          details: "invalid yaml",
        },
      },
    ]);

    await host.warmup();
    const initialized = await host.handleJsonLines({
      lines: [encodeMessage({ id: 7, method: "initialize", params: {} })],
    });
    const drained = await host.drainEvents({ limit: 1 });

    expect(decodeMessage(initialized.lines[0] ?? "")).toMatchObject({
      id: 7,
      result: {
        serverInfo: { name: "app-server" },
      },
    });
    expect(decodeMessage(drained.lines[0] ?? "")).toEqual({
      method: "configWarning",
      params: {
        summary: "test initialize config warning",
        path: "/tmp/lime/config.yaml",
        details: "invalid yaml",
      },
    });
    expect(fakeConnection.request).not.toHaveBeenCalled();
  });

  it("drainEvents 应透传 typed model/list/updated notification", async () => {
    const { ElectronAppServerHost } = await import("./appServerHost");
    const host = new ElectronAppServerHost();
    enqueueFakeNotifications([
      {
        method: "model/list/updated",
        params: { generation: 17, providerId: "openai" },
      },
    ]);

    const drained = await host.drainEvents({ limit: 1 });

    expect(decodeMessage(drained.lines[0] ?? "")).toEqual({
      method: "model/list/updated",
      params: { generation: 17, providerId: "openai" },
    });
  });

  it("drainEvents 首条后只排空已缓冲消息，避免把流式首字扣到回合结束", async () => {
    const { ElectronAppServerHost } = await import("./appServerHost");
    const host = new ElectronAppServerHost();
    enqueueFakeNotifications([
      agentSessionEventMessage({
        eventId: "evt-first-delta",
        sequence: 2,
        type: "message.delta",
      }),
      agentSessionEventMessage({
        eventId: "evt-second-delta",
        sequence: 3,
        type: "message.delta",
      }),
    ]);

    const drained = await host.drainEvents({ limit: 50 });

    expect(drained.lines).toHaveLength(2);
    expect(
      fakeConnection.nextServerMessage.mock.calls.map(
        ([timeoutMs]) => timeoutMs,
      ),
    ).toEqual([25, 0, 0]);
  });

  it("drainEvents 应隐藏 raw server request id 并只接受一次 action token", async () => {
    const { ElectronAppServerHost } = await import("./appServerHost");
    const host = new ElectronAppServerHost();
    enqueueFakeNotifications([
      {
        id: "app-server-request:7",
        method: "mcpServer/elicitation/request",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          serverName: "form-server",
          mode: "form",
          _meta: null,
          message: "Choose a value",
          requestedSchema: {
            type: "object",
            properties: {},
          },
        },
      },
    ]);

    const drained = await host.drainEvents({ limit: 1 });
    const projectedRequest = decodeMessage(drained.lines[0] ?? "");
    expect(projectedRequest).toMatchObject({
      id: expect.stringMatching(/^electron-action:[0-9a-f-]+$/u),
      method: "mcpServer/elicitation/request",
    });
    const actionToken = (projectedRequest as JsonRpcRequest).id;
    expect(actionToken).not.toBe("app-server-request:7");

    await host.handleJsonLines({
      lines: [
        encodeMessage({
          id: actionToken,
          result: {
            action: "accept",
            content: { confirmed: true },
          },
        }),
      ],
    });

    expect(fakeConnection.transport.send).toHaveBeenCalledWith({
      id: "app-server-request:7",
      result: {
        action: "accept",
        content: { confirmed: true },
      },
    });

    await expect(
      host.handleJsonLines({
        lines: [
          encodeMessage({ id: actionToken, result: { action: "cancel" } }),
        ],
      }),
    ).rejects.toThrow("action token was already used");
  });

  it("drainEvents 应隐藏 Electron Host 已消费请求的 resolved 通知", async () => {
    const { ElectronAppServerHost } = await import("./appServerHost");
    const host = new ElectronAppServerHost();
    enqueueFakeNotifications([
      {
        method: "serverRequest/resolved",
        params: { requestId: "host-consumed-request" },
      },
      {
        method: "model/list/updated",
        params: { generation: 18, providerId: "openai" },
      },
    ]);

    const drained = await host.drainEvents({ limit: 1 });

    expect(drained.lines).toHaveLength(1);
    expect(decodeMessage(drained.lines[0] ?? "")).toEqual({
      method: "model/list/updated",
      params: { generation: 18, providerId: "openai" },
    });
  });

  it("drainEvents 应保留 Renderer 请求的 tokenized resolved 通知", async () => {
    const { ElectronAppServerHost } = await import("./appServerHost");
    const host = new ElectronAppServerHost();
    enqueueFakeNotifications([
      {
        id: "app-server-request:resolved-1",
        method: "mcpServer/elicitation/request",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          serverName: "form-server",
          mode: "form",
          message: "Choose a value",
          requestedSchema: { type: "object", properties: {} },
        },
      },
    ]);
    const request = decodeMessage(
      (await host.drainEvents({ limit: 1 })).lines[0] ?? "",
    ) as JsonRpcRequest;
    enqueueFakeNotifications([
      {
        method: "serverRequest/resolved",
        params: { requestId: "app-server-request:resolved-1" },
      },
    ]);

    const resolved = decodeMessage(
      (await host.drainEvents({ limit: 1 })).lines[0] ?? "",
    );

    expect(resolved).toEqual({
      method: "serverRequest/resolved",
      params: { requestId: request.id },
    });
  });

  it("drainEvents 应在 Electron host 回答 currentTime/read 且不投递 Renderer", async () => {
    const { ElectronAppServerHost } = await import("./appServerHost");
    const host = new ElectronAppServerHost();
    const now = vi.spyOn(Date, "now").mockReturnValue(1_783_860_000_987);
    enqueueFakeNotifications([
      {
        id: "app-server-clock:7",
        method: "currentTime/read",
        params: { threadId: "thread-clock" },
      },
      {
        id: "app-server-request:8",
        method: "mcpServer/elicitation/request",
        params: {
          threadId: "thread-clock",
          turnId: "turn-clock",
          serverName: "form-server",
          mode: "form",
          message: "Choose a value",
          requestedSchema: { type: "object", properties: {} },
        },
      },
    ]);

    try {
      const drained = await host.drainEvents({ limit: 1 });
      const rendererMessage = decodeMessage(drained.lines[0] ?? "");

      expect(fakeConnection.respondServerRequest).toHaveBeenCalledTimes(1);
      expect(fakeConnection.respondServerRequest).toHaveBeenCalledWith(
        "app-server-clock:7",
        { currentTimeAt: 1_783_860_000 },
      );
      expect(rendererMessage).toMatchObject({
        id: expect.stringMatching(/^electron-action:[0-9a-f-]+$/u),
        method: "mcpServer/elicitation/request",
      });
      expect(drained.lines.join("\n")).not.toContain("currentTime/read");
    } finally {
      now.mockRestore();
    }
  });

  it("drainEvents includeRecent 应允许第二观察者读取最近已消费 notification", async () => {
    const { ElectronAppServerHost } = await import("./appServerHost");
    const host = new ElectronAppServerHost();
    enqueueFakeNotifications([
      agentSessionEventMessage({
        eventId: "evt-tool-started",
        sequence: 2,
        type: "tool.started",
      }),
    ]);

    const consumed = await host.drainEvents({ limit: 1 });
    expect(decodeMessage(consumed.lines[0] ?? "")).toMatchObject({
      method: "agentSession/event",
      params: {
        event: {
          eventId: "evt-tool-started",
          type: "tool.started",
        },
      },
    });

    const replayed = await host.drainEvents({
      includeRecent: true,
      limit: 5,
    });
    const replayedMessages = replayed.lines.map(decodeMessage);

    expect(replayedMessages).toEqual([
      expect.objectContaining({
        method: "agentSession/event",
        params: {
          event: expect.objectContaining({
            eventId: "evt-tool-started",
            type: "tool.started",
          }),
        },
      }),
    ]);
  });

  it("连接层提前消费 notification 后，includeRecent 仍应可回放 typed notification", async () => {
    const { ElectronAppServerHost } = await import("./appServerHost");
    const host = new ElectronAppServerHost();
    await host.warmup();

    emitFakeNotification({
      method: "item/mcpToolCall/progress",
      params: {
        threadId: "thread-mcp",
        turnId: "turn-mcp",
        itemId: "item-mcp",
        message: "工具服务列表已更新",
        notificationKind: "mcp_tools_changed",
      },
    });

    const replayed = await host.drainEvents({
      includeRecent: true,
      limit: 5,
    });

    expect(replayed.lines.map(decodeMessage)).toEqual([
      {
        method: "item/mcpToolCall/progress",
        params: {
          threadId: "thread-mcp",
          turnId: "turn-mcp",
          itemId: "item-mcp",
          message: "工具服务列表已更新",
          notificationKind: "mcp_tools_changed",
        },
      },
    ]);
    expect(fakeConnection.nextServerMessage).toHaveBeenCalled();
  });

  it("drainEvents includeRecent 应按 eventId 去重并保留工具生命周期终态", async () => {
    const { ElectronAppServerHost } = await import("./appServerHost");
    const host = new ElectronAppServerHost();
    enqueueFakeNotifications([
      agentSessionEventMessage({
        eventId: "evt-tool-started",
        sequence: 2,
        type: "tool.started",
      }),
      agentSessionEventMessage({
        eventId: "evt-tool-result",
        sequence: 3,
        type: "tool.result",
      }),
      agentSessionEventMessage({
        eventId: "evt-turn-completed",
        sequence: 4,
        type: "turn.completed",
      }),
      agentSessionEventMessage({
        eventId: "evt-tool-result",
        sequence: 3,
        type: "tool.result",
      }),
    ]);

    await host.drainEvents({ limit: 4 });

    const replayed = await host.drainEvents({
      includeRecent: true,
      limit: 3,
    });
    const events = replayed.lines
      .map(decodeMessage)
      .map((message) =>
        "params" in message &&
        message.params &&
        typeof message.params === "object" &&
        !Array.isArray(message.params)
          ? (message.params as { event?: unknown }).event
          : null,
      )
      .filter(Boolean) as Array<{ eventId: string; type: string }>;

    expect(events.map((event) => event.eventId)).toEqual([
      "evt-tool-started",
      "evt-tool-result",
      "evt-turn-completed",
    ]);
    expect(events.map((event) => event.type)).toEqual([
      "tool.started",
      "tool.result",
      "turn.completed",
    ]);
  });

  it("交互command/exec保留协议生命周期，不注入Host超时", async () => {
    const { ElectronAppServerHost } = await import("./appServerHost");
    const host = new ElectronAppServerHost();
    await host.handleJsonLines({
      lines: [
        encodeMessage({
          id: "terminal",
          method: "command/exec",
          params: { command: ["/bin/sh", "-i"], disableTimeout: true },
        }),
      ],
    });
    const calls = fakeConnection.request.mock.calls as unknown as Array<
      [JsonRpcRequest, string, { timeoutMs?: number }]
    >;
    expect(calls.at(-1)?.[1]).toBe("command/exec");
    expect(calls.at(-1)?.[2].timeoutMs).toBeUndefined();
  });

  it("请求级超时可延长插件安装的等待窗口", async () => {
    const { ElectronAppServerHost } = await import("./appServerHost");
    const host = new ElectronAppServerHost();

    await host.handleJsonLines({
      timeoutMs: 240000,
      lines: [
        encodeMessage({
          id: "remote-plugin-install-long-request",
          method: "plugin/install",
          params: {
            remoteMarketplaceName: "workspace-directory",
            pluginName: "opaque~1",
          },
        }),
      ],
    });

    const requestCalls = fakeConnection.request.mock.calls as unknown as Array<
      [JsonRpcRequest, string, { timeoutMs?: number }]
    >;
    expect(requestCalls[0]?.[1]).toBe("plugin/install");
    expect(requestCalls[0]?.[2]).toMatchObject({ timeoutMs: 240000 });
  });

  it("插件安装、协调与分享保留长等待窗口", async () => {
    const { ElectronAppServerHost } = await import("./appServerHost");
    const host = new ElectronAppServerHost();

    await host.handleJsonLines({
      lines: [
        encodeMessage({
          id: "remote-plugin-install",
          method: "plugin/install",
          params: {
            remoteMarketplaceName: "workspace-directory",
            pluginName: "opaque~1",
          },
        }),
        encodeMessage({
          id: "remote-plugin-reconcile",
          method: "plugin/reconcile",
          params: {},
        }),
        ...["save", "list", "updateTargets", "checkout", "delete"].map(
          (operation) =>
            encodeMessage({
              id: `share-${operation}`,
              method: `plugin/share/${operation}`,
              params: {},
            }),
        ),
      ],
    });

    const requestCalls = fakeConnection.request.mock.calls as unknown as Array<
      [JsonRpcRequest, string, { timeoutMs?: number }]
    >;
    expect(requestCalls.map(([, method]) => method)).toEqual([
      "plugin/install",
      "plugin/reconcile",
      "plugin/share/save",
      "plugin/share/list",
      "plugin/share/updateTargets",
      "plugin/share/checkout",
      "plugin/share/delete",
    ]);
    expect(requestCalls.map(([, , options]) => options.timeoutMs)).toEqual([
      150000, 150000, 150000, 150000, 150000, 150000, 150000,
    ]);
  });
});
