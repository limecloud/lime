// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import process from "node:process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type {
  CloudDesktopParams,
  JsonRpcMessage,
  JsonRpcRequest,
} from "../packages/app-server-client/src/index";

vi.mock(
  "@limecloud/app-server-client",
  () => import("../packages/app-server-client/src/index"),
);
vi.mock("./electronRuntime", () => ({
  app: {
    getVersion: () => "test",
    getPath: () => "/tmp/lime-remote-test",
    getAppPath: () => process.cwd(),
    isDefaultProtocolClient: () => false,
  },
}));
const { dynamicConstructor } = vi.hoisted(() => ({
  dynamicConstructor: vi.fn(),
}));
const { guestUpload } = vi.hoisted(() => ({ guestUpload: vi.fn() }));
vi.mock("./cloudGuestUpload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./cloudGuestUpload")>()),
  requestCloudGuestUpload: guestUpload,
}));
vi.mock("./appServerDynamicToolHost", () => ({
  AppServerDynamicToolHost: class {
    constructor() {
      dynamicConstructor();
    }
  },
}));

import { ElectronAppServerHost } from "./appServerHost";
import { AppServerRemoteConnection } from "./appServerRemoteConnection";
import { CloudDesktopWindows } from "./cloudDesktopWindows";
import { CloudModelConnections } from "./cloudModelConnections";
import { ElectronSecureCredentialStore } from "./secureCredentialStore";
import { LocalCredentialEncryption } from "./localCredentialEncryption";
import type { CloudGuestUpload } from "./cloudGuestUpload";
import { isCloudWindowHostCommand } from "./cloudWindowPolicy";
import { isCloudRendererAsset } from "./cloudDesktopWindowFactory";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
  vi.clearAllMocks();
});

async function fixture() {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  const received: JsonRpcRequest[] = [];
  const headers: string[] = [];
  const sockets: WebSocket[] = [];
  server.on("connection", (socket, request) => {
    sockets.push(socket);
    headers.push(request.headers.authorization ?? "");
    socket.on("message", (bytes) => {
      const message = JSON.parse(bytes.toString()) as JsonRpcRequest;
      received.push(message);
      if (message.method === "initialized" || message.id === undefined) return;
      if (message.method === "initialize") {
        socket.send(
          JSON.stringify({
            id: message.id,
            result: {
              serverInfo: {
                name: "app-server",
                version: "test",
                protocolVersion: "appserver.v0",
              },
              platform: { family: "unix", os: "linux" },
              capabilities: {
                agentSession: true,
                capabilityDiscovery: true,
                artifact: true,
                evidence: true,
                workspace: true,
              },
            },
          }),
        );
      } else if (message.method === "test/disconnect") {
        socket.close();
      } else {
        socket.send(
          JSON.stringify({
            id: message.id,
            result: { source: "remote-fixture", params: message.params },
          }),
        );
      }
    });
  });
  cleanup.push(async () => {
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("missing fixture address");
  return {
    url: `ws://127.0.0.1:${address.port}/rpc`,
    received,
    headers,
    sockets,
  };
}

async function remoteHost(url: string) {
  const host = new ElectronAppServerHost(
    null,
    null,
    new AppServerRemoteConnection(async () => ({
      websocketUrl: url,
      authToken: "fixture-token",
    })),
  );
  cleanup.push(() => host.stop());
  await host.warmup();
  return host;
}

describe("remote Desktop Host through real WebSocket", () => {
  it("uses the shared JSON-RPC proxy without installing local tools or leaking local preferences", async () => {
    const remote = await fixture();
    const host = await remoteHost(remote.url);
    const reply = await host.handleJsonLines({
      lines: [
        JSON.stringify({
          id: 42,
          method: "thread/start",
          params: { cwd: "/home/cloud/project" },
        }),
      ],
    });
    const response = JSON.parse(reply.lines[0]);
    expect(response.id).toBe(42);
    expect(response.result.source).toBe("remote-fixture");
    expect(remote.headers).toEqual(["Bearer fixture-token"]);
    expect(
      remote.received.find((request) => request.method === "thread/start")
        ?.params,
    ).toEqual({ cwd: "/home/cloud/project" });
    expect(dynamicConstructor).not.toHaveBeenCalled();
    expect(host.getDiagnostics()).toMatchObject({
      connected: true,
      sidecar: null,
      connection_generation: 1,
    });
  });

  it("does not replay a lost mutation or reconnect on polling; explicit reconnect invalidates old approvals", async () => {
    const remote = await fixture();
    const host = await remoteHost(remote.url);
    remote.sockets[0].send(
      JSON.stringify({
        id: "approval-1",
        method: "item/commandExecution/requestApproval",
        params: {},
      }),
    );
    const events = await host.drainEvents();
    const token = (
      events.lines.map((line) => JSON.parse(line)) as JsonRpcRequest[]
    ).find(
      (message) => message.method === "item/commandExecution/requestApproval",
    )?.id;
    expect(token).toMatch(/^electron-action:/);
    await expect(host.request("test/disconnect")).rejects.toThrow();
    await expect(host.drainEvents()).rejects.toThrow(/reconnect explicitly/);
    await expect(host.request("test/after-disconnect")).rejects.toThrow(
      /reconnect explicitly/,
    );
    expect(remote.sockets).toHaveLength(1);
    expect(
      remote.received.filter((request) => request.method === "test/disconnect"),
    ).toHaveLength(1);
    expect(host.getDiagnostics().connected).toBe(false);
    await Promise.all([
      host.recoverAfterSystemResume(),
      host.recoverAfterSystemResume(),
    ]);
    expect(remote.sockets).toHaveLength(2);
    expect(host.getDiagnostics()).toMatchObject({
      connected: true,
      connection_generation: 2,
    });
    await expect(
      host.handleJsonLines({
        lines: [JSON.stringify({ id: token, result: { decision: "accept" } })],
      }),
    ).rejects.toThrow(/Unknown.*token/);
    await expect(
      host.handleJsonLines({
        lines: [JSON.stringify({ id: "approval-1", result: {} })],
      }),
    ).rejects.toThrow(/current action token/);
  });

  it("does not run native or current-time server requests on this computer", async () => {
    const remote = await fixture();
    const host = await remoteHost(remote.url);
    const request: JsonRpcMessage = {
      id: "local-tool",
      method: "item/tool/call",
      params: { tool: "macos_native_host_invoke", arguments: {} },
    };
    remote.sockets[0].send(JSON.stringify(request));
    const events = await host.drainEvents();
    expect(events.lines.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({
        method: "item/tool/call",
        id: expect.stringMatching(/^electron-action:/),
      }),
    ]);
    expect(dynamicConstructor).not.toHaveBeenCalled();
    expect(
      () =>
        new ElectronAppServerHost(
          {} as never,
          null,
          new AppServerRemoteConnection(async () => ({
            websocketUrl: remote.url,
          })),
        ),
    ).toThrow(/cannot own local/);
  });
});

const safeStorage = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => "gnome_libsecret",
  encryptString: (value: string) => Buffer.from(value).reverse(),
  decryptString: (value: Buffer) => Buffer.from(value).reverse().toString(),
};
const resource = {
  provider: "wuying" as const,
  profile: "fixture",
  regionId: "cn-test",
  resourceId: "ecd-fixture-a",
};

function fakeWindow(id: number) {
  let closed = false;
  let onClosed = () => undefined as void;
  return {
    webContents: { id, send: vi.fn() },
    isDestroyed: () => closed,
    show: vi.fn(),
    focus: vi.fn(),
    once: (_event: "closed", listener: () => void) => {
      onClosed = listener;
    },
    close: () => {
      closed = true;
      onClosed();
    },
  };
}

describe("BYOC window and credential isolation", () => {
  const ecsResource = {
    ...resource,
    provider: "ecs" as const,
    resourceId: "i-managed",
  };
  const listening = (endpoint: string) => ({
    data: {
      state: "listening",
      channel: "appServer",
      persistent: false,
      endpoint,
    },
  });

  it("preserves the exact task connection until a pending model delivery is reconciled", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "lime-cloud-model-pending-"),
    );
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const request = vi.fn();
    const manager = new CloudDesktopWindows(
      root,
      safeStorage,
      () => fakeWindow(1),
      request,
      async () => undefined,
    );
    cleanup.push(() => manager.stop());
    await manager.invoke({
      action: "saveEcsTunnel",
      resource: ecsResource,
      token: "original-token",
    });
    const key = createHash("sha256")
      .update(
        JSON.stringify([
          ecsResource.provider,
          ecsResource.profile,
          ecsResource.regionId,
          ecsResource.resourceId,
        ]),
      )
      .digest("hex");
    const storageRoot = path.join(root, "cloud-desktop-connections", key);
    const store = new ElectronSecureCredentialStore(storageRoot, safeStorage);
    const original = (await store.readCloudSessionCredential())!;
    const owner = new CloudModelConnections(safeStorage, request);
    await expect(
      owner.invoke(
        storageRoot,
        ecsResource,
        original,
        {
          action: "shareModelConnection",
          resource: ecsResource,
          providerId: "selected",
          keyId: "selected-key",
          confirmation: `share-model:${ecsResource.regionId}:${ecsResource.resourceId}:selected:selected-key`,
        },
        async () => {
          throw new Error("response lost");
        },
      ),
    ).rejects.toThrow("CLOUD_MODEL_CONNECTION_FAILED");
    for (const change of [
      { action: "delete" as const, resource: ecsResource },
      {
        action: "saveEcsTunnel" as const,
        resource: ecsResource,
        token: "replacement",
      },
      {
        action: "save" as const,
        resource: ecsResource,
        endpoint: "wss://changed.invalid",
        token: "replacement",
      },
      {
        action: "reconnectRuntime" as const,
        resource: ecsResource,
        confirmation: `reconnectRuntime:${ecsResource.regionId}:${ecsResource.resourceId}`,
        workSaved: true,
      },
    ])
      await expect(manager.invoke(change)).rejects.toThrow(
        "CLOUD_MODEL_CONNECTION_UNRESOLVED",
      );
    expect(await store.readCloudSessionCredential()).toEqual(original);
    expect(request).not.toHaveBeenCalled();
    const status = await manager.invoke({
      action: "modelConnectionStatus",
      resource: ecsResource,
    });
    expect(status).toMatchObject({ phase: "preparing" });
    if (!("kind" in status) || status.kind !== "modelConnection")
      throw new Error("missing model intent");
    await owner.invoke(
      storageRoot,
      ecsResource,
      original,
      {
        action: "resumeModelConnection",
        resource: ecsResource,
        operationId: status.operationId!,
      },
      async () => ({
        data: { operationId: status.operationId, phase: "expired" },
      }),
    );
    await manager.invoke({
      action: "saveEcsTunnel",
      resource: ecsResource,
      token: "replacement",
    });
    expect((await store.readCloudSessionCredential())?.token).toBe(
      "replacement",
    );
    await manager.invoke({ action: "delete", resource: ecsResource });
    expect(await store.readCloudSessionCredential()).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it("replaces only the exact ECS credential after rotation, fences stale opens and recovers after restart", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "lime-ecs-rotation-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const remote = await fixture();
    const encryption = new LocalCredentialEncryption(root);
    const expiresAt = Math.floor(Date.now() / 1000) + 120;
    const newToken = "synthetic_rotated_".repeat(3);
    let phase = "waiting";
    let release: () => void = () => undefined;
    const rotation = new Promise<void>((resolve) => {
      release = resolve;
    });
    guestUpload.mockImplementation(
      async (target: CloudGuestUpload, _capability: string, route: string) => {
        if (route === "/reconnect") {
          await rotation;
          phase = "installed";
        }
        if (route === "/credentials")
          return {
            operationId: target.operationId,
            token: newToken,
            viewerPassword: "newVnc88",
          };
        if (route === "/finish") return { phase: "finished" };
        return { operationId: target.operationId, phase, expiresAt };
      },
    );
    const request = vi.fn(async (params: CloudDesktopParams) => {
      if (
        params.action === "openEcsTunnel" &&
        params.channel === "installation"
      )
        return {
          data: {
            state: "listening",
            channel: "installation",
            persistent: false,
            endpoint: "https://127.0.0.1:34567/",
          },
        };
      if (
        params.action === "closeEcsTunnel" &&
        params.channel === "installation"
      )
        return {
          data: { state: "closed", channel: "installation", persistent: false },
        };
      if (params.action === "openEcsTunnel")
        return listening(remote.url.replace("/rpc", "/"));
      if (params.action !== "reconnectEcsRuntime")
        throw new Error("unexpected request");
      return {
        data: {
          operationId: params.operationId,
          request: params,
          outcome: "runtimeUploadReady",
          expiresAt,
          upload: {
            operationId: params.operationId,
            certificate: "synthetic-public-certificate",
            expiresAt,
          },
        },
      };
    });
    const picker = vi.fn(async () => undefined);
    const manager = new CloudDesktopWindows(
      root,
      encryption,
      () => fakeWindow(1),
      request,
      picker,
    );
    cleanup.push(() => manager.stop());
    await manager.invoke({
      action: "saveEcsTunnel",
      resource: ecsResource,
      token: "synthetic_old_token",
    });
    expect(
      await manager.invoke({
        action: "installationStatus",
        resource: ecsResource,
      }),
    ).toMatchObject({ exists: false, connectionSaved: true });
    const reconnect = {
      action: "reconnectRuntime" as const,
      resource: ecsResource,
      confirmation: `reconnectRuntime:${ecsResource.regionId}:${ecsResource.resourceId}`,
      workSaved: true,
    };
    const directResource = { ...ecsResource, resourceId: "i-direct" };
    await manager.invoke({
      action: "save",
      resource: directResource,
      endpoint: "wss://synthetic.invalid/",
      token: "synthetic_direct_token",
    });
    await expect(
      manager.invoke({
        ...reconnect,
        resource: directResource,
        confirmation: `reconnectRuntime:${directResource.regionId}:${directResource.resourceId}`,
      }),
    ).rejects.toThrow("CLOUD_INSTALL_CONNECTION_CHANGED");
    expect(request).not.toHaveBeenCalled();
    await manager.invoke(reconnect);
    await vi.waitFor(() =>
      expect(
        guestUpload.mock.calls.some(([, , route]) => route === "/reconnect"),
      ).toBe(true),
    );
    for (const action of ["open", "delete"] as const) {
      await expect(
        manager.invoke({ action, resource: ecsResource }),
      ).rejects.toThrow("CLOUD_INSTALL_UNRESOLVED");
    }
    await expect(
      manager.invoke({
        action: "saveEcsTunnel",
        resource: ecsResource,
        token: "other",
      }),
    ).rejects.toThrow("CLOUD_INSTALL_UNRESOLVED");
    const requestsBeforeSharing = request.mock.calls.length;
    await expect(
      manager.invoke({
        action: "shareModelConnection",
        resource: ecsResource,
        providerId: "selected",
        keyId: "selected-key",
        confirmation: `share-model:${ecsResource.regionId}:${ecsResource.resourceId}:selected:selected-key`,
      }),
    ).rejects.toThrow("CLOUD_MODEL_CONNECTION_FAILED");
    expect(request).toHaveBeenCalledTimes(requestsBeforeSharing);
    expect(
      await manager.invoke({
        action: "modelConnectionStatus",
        resource: ecsResource,
      }),
    ).toMatchObject({ phase: "idle" });
    release();
    await vi.waitFor(
      async () =>
        expect(
          await manager.invoke({
            action: "installationStatus",
            resource: ecsResource,
          }),
        ).toMatchObject({ phase: "complete", connectionSaved: true }),
      { timeout: 10000 },
    );
    expect(picker).not.toHaveBeenCalled();
    const key = createHash("sha256")
      .update(
        JSON.stringify([
          ecsResource.provider,
          ecsResource.profile,
          ecsResource.regionId,
          ecsResource.resourceId,
        ]),
      )
      .digest("hex");
    const storageRoot = path.join(root, "cloud-desktop-connections", key);
    const credential = await new ElectronSecureCredentialStore(
      storageRoot,
      encryption,
    ).readCloudSessionCredential();
    expect(credential).toMatchObject({
      token: newToken,
      transport: "ecsTunnel",
      endpoint: "ws://127.0.0.1:8787/",
    });
    expect(
      (
        await readFile(
          path.join(storageRoot, "credentials/app-server-session.v1"),
        )
      ).includes(Buffer.from(newToken)),
    ).toBe(false);
    await manager.invoke({ action: "open", resource: ecsResource });
    expect(remote.headers).toEqual(["Bearer " + newToken]);
    await expect(manager.invoke(reconnect)).rejects.toThrow(
      "CLOUD_INSTALL_CONNECTION_EXISTS",
    );
    await manager.stop();
    const restarted = new CloudDesktopWindows(
      root,
      encryption,
      () => fakeWindow(2),
      request,
      picker,
    );
    cleanup.push(() => restarted.stop());
    const status = await restarted.invoke({
      action: "installationStatus",
      resource: ecsResource,
    });
    expect(status).toMatchObject({ phase: "complete", connectionSaved: true });
    expect(JSON.stringify(status)).not.toContain(newToken);
    expect(
      request.mock.calls.filter(
        ([params]) => params.action === "reconnectEcsRuntime",
      ),
    ).toHaveLength(1);
    expect(
      guestUpload.mock.calls.filter(([, , route]) => route === "/reconnect"),
    ).toHaveLength(1);
  });

  it("resolves the user's ECS on explicit open and preserves isolation across restarts and port changes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "lime-ecs-window-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const first = await fixture();
    const second = await fixture();
    const request = vi
      .fn()
      .mockResolvedValue(listening(first.url.replace("/rpc", "/")));
    const partitions: string[] = [];
    let id = 0;
    const createWindow = (_context: unknown, partition: string) => {
      partitions.push(partition);
      return fakeWindow(++id);
    };
    const manager = new CloudDesktopWindows(
      root,
      safeStorage,
      createWindow,
      request,
    );
    cleanup.push(() => manager.stop());
    const metadata = await manager.invoke({
      action: "saveEcsTunnel",
      resource: ecsResource,
      token: "managed-secret",
    });
    expect(metadata).toMatchObject({
      exists: true,
      transport: "ecsTunnel",
      endpoint: "ws://127.0.0.1:8787/",
    });
    expect(metadata).not.toHaveProperty("token");
    expect(request).not.toHaveBeenCalled();
    await Promise.all([
      manager.invoke({ action: "open", resource: ecsResource }),
      manager.invoke({ action: "open", resource: ecsResource }),
    ]);
    expect(request).toHaveBeenCalledExactlyOnceWith({
      action: "openEcsTunnel",
      resource: ecsResource,
      channel: "appServer",
    });
    expect(first.headers).toEqual(["Bearer managed-secret"]);
    expect(manager.get(1)?.context.endpoint).toBe("ws://127.0.0.1:8787/");
    await manager.stop();
    request.mockResolvedValue(listening(second.url.replace("/rpc", "/")));
    const restarted = new CloudDesktopWindows(
      root,
      safeStorage,
      createWindow,
      request,
    );
    cleanup.push(() => restarted.stop());
    expect(
      await restarted.invoke({ action: "status", resource: ecsResource }),
    ).toMatchObject({ transport: "ecsTunnel" });
    expect(request).toHaveBeenCalledTimes(1);
    await restarted.invoke({ action: "open", resource: ecsResource });
    expect(second.headers).toEqual(["Bearer managed-secret"]);
    expect(partitions).toHaveLength(2);
    expect(partitions[0]).toBe(partitions[1]);
    const files = await readdir(path.join(root, "cloud-desktop-connections"), {
      recursive: true,
    });
    const file = files.find((value) =>
      value.endsWith("app-server-session.v1"),
    )!;
    const encrypted = await readFile(
      path.join(root, "cloud-desktop-connections", file),
    );
    const decoded = safeStorage.decryptString(encrypted);
    expect(decoded).not.toContain(new URL(first.url).port);
    expect(decoded).not.toContain(new URL(second.url).port);
    expect(encrypted.includes(Buffer.from("managed-secret"))).toBe(false);
  });

  it("renews only the App Server channel on explicit reconnect and never replays a lost mutation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "lime-ecs-reconnect-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const first = await fixture();
    const second = await fixture();
    const request = vi
      .fn()
      .mockResolvedValue(listening(first.url.replace("/rpc", "/")));
    const manager = new CloudDesktopWindows(
      root,
      safeStorage,
      () => fakeWindow(1),
      request,
    );
    cleanup.push(() => manager.stop());
    await manager.invoke({
      action: "saveEcsTunnel",
      resource: ecsResource,
      token: "managed-secret",
    });
    await manager.invoke({ action: "open", resource: ecsResource });
    const entry = manager.get(1)!;
    await expect(entry.host.request("test/disconnect")).rejects.toThrow();
    await expect(
      manager.invokeWindow(entry, "app_server_drain_events"),
    ).rejects.toThrow(/reconnect explicitly/);
    expect(request).toHaveBeenCalledTimes(1);
    request.mockResolvedValue(listening(second.url.replace("/rpc", "/")));
    await manager.invokeWindow(entry, "cloud_desktop_window_reconnect");
    expect(request.mock.calls.map(([params]) => params.action)).toEqual([
      "openEcsTunnel",
      "closeEcsTunnel",
      "openEcsTunnel",
    ]);
    expect(
      request.mock.calls.every(
        ([params]) =>
          params.resource === ecsResource ||
          params.resource.resourceId === ecsResource.resourceId,
      ),
    ).toBe(true);
    expect(
      request.mock.calls.every(([params]) => params.channel === "appServer"),
    ).toBe(true);
    expect(
      second.received.some((value) => value.method === "test/disconnect"),
    ).toBe(false);
    expect(manager.status(entry)).toMatchObject({
      connected: true,
      generation: 2,
    });
    request.mockResolvedValue({
      data: {
        state: "listening",
        channel: "desktop",
        persistent: false,
        endpoint: "http://127.0.0.1:12345/vnc.html",
      },
    });
    expect(
      await manager.invokeWindow(entry, "cloud_desktop_window_view", {
        request: {
          action: "connect",
          resource: { ...ecsResource, resourceId: "i-other" },
        },
      }),
    ).toEqual({ endpoint: "http://127.0.0.1:12345/vnc.html" });
    expect(request).toHaveBeenLastCalledWith({
      action: "openEcsTunnel",
      resource: ecsResource,
      channel: "desktop",
    });
    expect(manager.status(entry).generation).toBe(2);
    await expect(
      manager.invokeWindow(entry, "cloud_desktop_window_view", {
        request: { action: "human" },
      }),
    ).rejects.toThrow(/^CLOUD_DESKTOP_VIEW_UNAVAILABLE$/);
    await expect(
      manager.invokeWindow(entry, "cloud_desktop_window_view", {
        request: { action: "showPassword" },
      }),
    ).rejects.toThrow(/^CLOUD_DESKTOP_PASSWORD_UNAVAILABLE$/);
    let resolve!: (value: unknown) => void;
    request.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const late = manager.invokeWindow(entry, "cloud_desktop_window_view", {
      request: { action: "connect" },
    });
    const rejected = expect(late).rejects.toThrow(
      /^CLOUD_DESKTOP_VIEW_UNAVAILABLE$/,
    );
    entry.window.close();
    resolve({
      data: {
        state: "listening",
        channel: "desktop",
        persistent: false,
        endpoint: "http://127.0.0.1:12345/vnc.html",
      },
    });
    await rejected;
  });

  it.each([
    {
      data: {
        state: "listening",
        channel: "appServer",
        persistent: false,
        endpoint: "wss://untrusted.test/?token=secret",
      },
    },
    {
      data: {
        state: "listening",
        channel: "desktop",
        persistent: false,
        endpoint: "ws://127.0.0.1:12345",
      },
    },
    { data: { state: "closed", channel: "appServer", persistent: false } },
  ])(
    "rejects invalid tunnel metadata before sending the guest token",
    async (response) => {
      const root = await mkdtemp(path.join(os.tmpdir(), "lime-ecs-denied-"));
      cleanup.push(() => rm(root, { recursive: true, force: true }));
      const request = vi.fn().mockResolvedValue(response);
      const createWindow = vi.fn(() => fakeWindow(1));
      const manager = new CloudDesktopWindows(
        root,
        safeStorage,
        createWindow,
        request,
      );
      cleanup.push(() => manager.stop());
      await manager.invoke({
        action: "saveEcsTunnel",
        resource: ecsResource,
        token: "managed-secret",
      });
      await expect(
        manager.invoke({ action: "open", resource: ecsResource }),
      ).rejects.toThrow("ECS_TUNNEL_FAILED");
      expect(createWindow).not.toHaveBeenCalled();
      expect(JSON.stringify(request.mock.calls)).not.toContain(
        "managed-secret",
      );
    },
  );

  it("projects only a fixed network diagnostic and rejects managed connections for Wuying", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "lime-ecs-network-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const request = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "ErrorCode=InvalidOperation.SecurityGroupRuleDenied supplier-secret",
        ),
      );
    const manager = new CloudDesktopWindows(
      root,
      safeStorage,
      () => fakeWindow(1),
      request,
    );
    cleanup.push(() => manager.stop());
    await expect(
      manager.invoke({ action: "saveEcsTunnel", resource, token: "secret" }),
    ).rejects.toThrow(/require an ECS/);
    expect(await manager.invoke({ action: "status", resource })).toMatchObject({
      exists: false,
    });
    await manager.invoke({
      action: "saveEcsTunnel",
      resource: ecsResource,
      token: "secret",
    });
    await expect(
      manager.invoke({ action: "open", resource: ecsResource }),
    ).rejects.toThrow(/^ECS_SECURITY_GROUP_DENIED$/);
  });

  it("blocks arbitrary local asset paths in the isolated cloud session", () => {
    expect(
      isCloudRendererAsset("file:///app/dist/index.html", "/app/dist"),
    ).toBe(true);
    expect(
      isCloudRendererAsset("file:///app/dist/assets/main.js", "/app/dist"),
    ).toBe(true);
    for (const url of [
      "file:///Users/test/.ssh/id_ed25519",
      "asset://localhost/%2FUsers%2Ftest%2F.secret",
      "file:///app/dist-other/file.txt",
      "file:///app/dist/../secret.txt",
    ])
      expect(isCloudRendererAsset(url, "/app/dist")).toBe(false);
  });
  it("keeps account credentials separate, serializes open, isolates partitions, and denies local capabilities", async () => {
    const remote = await fixture();
    const root = await mkdtemp(path.join(os.tmpdir(), "lime-cloud-window-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const account = new ElectronSecureCredentialStore(root, safeStorage);
    await account.setCloudSessionCredential({
      tenantId: "account",
      endpoint: remote.url,
      token: "account-token",
    });
    const windows: ReturnType<typeof fakeWindow>[] = [];
    const partitions: string[] = [];
    const manager = new CloudDesktopWindows(
      root,
      safeStorage,
      (_context, partition) => {
        partitions.push(partition);
        const window = fakeWindow(windows.length + 1);
        windows.push(window);
        return window;
      },
    );
    cleanup.push(() => manager.stop());
    const metadata = await manager.invoke({
      action: "save",
      resource,
      endpoint: remote.url,
      token: "byoc-token",
    });
    expect(metadata).not.toHaveProperty("token");
    expect((await account.readCloudSessionCredential())?.token).toBe(
      "account-token",
    );
    await Promise.all([
      manager.invoke({ action: "open", resource }),
      manager.invoke({ action: "open", resource }),
    ]);
    expect(windows).toHaveLength(1);
    expect(remote.headers).toEqual(["Bearer byoc-token"]);
    const entry = manager.get(1)!;
    await expect(
      manager.invoke({
        action: "save",
        resource,
        endpoint: remote.url,
        token: "replacement",
      }),
    ).rejects.toThrow(/close the cloud/);
    for (const command of [
      "get_home_dir",
      "open_in_open",
      "macos_native_host_invoke",
      "windows_native_host_invoke",
      "browser_tab_mount",
      "cloud_session_credential_status",
      "cloud_desktop_connection",
      "save_exported_document",
      "desktop_permissions_request",
    ])
      await expect(manager.invokeWindow(entry, command)).rejects.toThrow(
        /local host capability/,
      );
    expect(
      await manager.invokeWindow(entry, "cloud_desktop_window_status"),
    ).toMatchObject({ kind: "cloud", connected: true });
    expect(isCloudWindowHostCommand("new_local_tool")).toBe(false);
    const second = { ...resource, resourceId: "ecd-fixture-b" };
    expect(
      await manager.invoke({ action: "status", resource: second }),
    ).toMatchObject({ exists: false });
    await manager.invoke({
      action: "save",
      resource: second,
      endpoint: remote.url,
      token: "second-token",
    });
    await manager.invoke({ action: "open", resource: second });
    expect(partitions[0]).not.toBe(partitions[1]);
    expect(manager.get(1)?.atoms).not.toBe(manager.get(2)?.atoms);
    windows[0].close();
    expect(manager.get(1)).toBeUndefined();
    expect(manager.isCloud(1)).toBe(true); // Late IPC must never fall back to the local Host.
    await manager.invoke({ action: "delete", resource });
    expect(await manager.invoke({ action: "status", resource })).toMatchObject({
      exists: false,
    });
    expect((await account.readCloudSessionCredential())?.token).toBe(
      "account-token",
    );
    const files = await readdir(path.join(root, "cloud-desktop-connections"), {
      recursive: true,
    });
    const credentialFile = files.find((file) =>
      file.endsWith("app-server-session.v1"),
    );
    expect(credentialFile).toBeTruthy();
    expect(
      (
        await readFile(
          path.join(root, "cloud-desktop-connections", credentialFile!),
        )
      ).includes(Buffer.from("second-token")),
    ).toBe(false);
  });
});
