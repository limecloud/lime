import { createHash } from "node:crypto";
import path from "node:path";
import { app } from "electron";
import type {
  CloudDesktopResource,
  CloudDesktopResponse,
} from "@limecloud/app-server-client";
import type {
  CloudArchiveDownloadResult,
  CloudArchiveRestoreResult,
  CloudDesktopConnectionMetadata,
  CloudDesktopConnectionRequest,
  CloudDesktopWindowContext,
  CloudDesktopWindowStatus,
  CloudGuestInstallationStatus,
  CloudGuestReleaseStatus,
  CloudGuestPreparationStatus,
  CloudReleaseBackupResult,
  CloudReleaseWithBackupResult,
  CloudModelConnectionStatus,
} from "../src/lib/desktop-host/cloudDesktopConnection";
import { ElectronAppServerHost } from "./appServerHost";
import { AppServerRemoteConnection } from "./appServerRemoteConnection";
import {
  ECS_APP_SERVER_TARGET,
  resolveCloudDesktopTaskTunnel,
  resolveCloudDesktopViewTunnel,
  type CloudDesktopRequest,
} from "./cloudDesktopTaskTunnel";
import { ElectronHostCommands } from "./hostCommands";
import { PersistedAtomHost } from "./persistedAtomHost";
import {
  ElectronSecureCredentialStore,
  type SafeStorageLike,
} from "./secureCredentialStore";
import { isCloudWindowHostCommand } from "./cloudWindowPolicy";
import { CloudGuestInstallations } from "./cloudGuestInstallations";
import { probeCloudGuestRelease } from "./cloudGuestRelease";
import { CloudGuestReleaseCache } from "./cloudGuestReleaseCache";
import { CloudGuestDistributions } from "./cloudGuestDistributions";
import {
  saveCloudArchive,
  validateArchiveSelection,
} from "./cloudArchiveDownload";
import {
  restoreCloudArchive,
  validateRestoreSelection,
} from "./cloudArchiveRestore";
import { CloudArchiveBackups } from "./cloudArchiveBackups";
import { allowCloudDesktopView } from "./cloudDesktopWindowFactory";
import { CloudModelConnections } from "./cloudModelConnections";

type CloudWindow = {
  webContents: { id: number; send(channel: string, payload: unknown): void };
  isDestroyed(): boolean;
  show(): void;
  focus(): void;
  close(): void;
  once(event: "closed", listener: () => void): unknown;
};
export type CloudWindowEntry = {
  context: CloudDesktopWindowContext;
  host: ElectronAppServerHost;
  commands: ElectronHostCommands;
  atoms: PersistedAtomHost;
  window: CloudWindow;
};

/** Owns only client windows, local UI state and encrypted connection credentials. */
export class CloudDesktopWindows {
  readonly #entries = new Map<number, CloudWindowEntry>();
  readonly #cloudIds = new Set<number>();
  readonly #queues = new Map<string, Promise<unknown>>();
  #stopping = false;
  readonly #archiveAbort = new AbortController();
  readonly #installations?: CloudGuestInstallations;
  readonly #archiveBackups: CloudArchiveBackups;
  #release?: CloudGuestReleaseCache;
  #distribution?: CloudGuestDistributions;

  #distributions(): CloudGuestDistributions {
    if (!this.requestCloudDesktop)
      throw new Error("CLOUD_INSTALL_RELEASE_UNAVAILABLE");
    return (this.#distribution ??= new CloudGuestDistributions(
      this.root,
      this.safeStorage,
      this.requestCloudDesktop,
      this.#releaseCache(),
    ));
  }

  #releaseCache(): CloudGuestReleaseCache {
    return (this.#release ??= new CloudGuestReleaseCache(
      this.root,
      app.getVersion(),
    ));
  }

  constructor(
    readonly root: string,
    readonly safeStorage: SafeStorageLike,
    readonly createWindow: (
      context: CloudDesktopWindowContext,
      partition: string,
    ) => CloudWindow,
    readonly requestCloudDesktop?: CloudDesktopRequest,
    selectArtifact?: () => Promise<string | undefined>,
    showDesktopPassword?: (password: string) => Promise<void>,
    readonly selectArchiveDestination?: () => Promise<string | undefined>,
  ) {
    this.#archiveBackups = new CloudArchiveBackups(safeStorage);
    if (requestCloudDesktop && selectArtifact) {
      this.#installations = new CloudGuestInstallations(
        root,
        safeStorage,
        requestCloudDesktop,
        selectArtifact,
        async (resource, token, replace) => {
          const key = resourceKey(resource);
          const store = new ElectronSecureCredentialStore(
            path.join(root, "cloud-desktop-connections", key),
            safeStorage,
          );
          const existing = await store.readCloudSessionCredential();
          if (
            existing &&
            ((!replace && existing.token !== token) ||
              existing.transport !== "ecsTunnel" ||
              existing.tenantId !== key ||
              existing.endpoint !== ECS_APP_SERVER_TARGET)
          )
            throw new Error("CLOUD_INSTALL_CONNECTION_CHANGED");
          await store.setCloudSessionCredential({
            tenantId: key,
            endpoint: ECS_APP_SERVER_TARGET,
            token,
            transport: "ecsTunnel",
          });
        },
        undefined,
        undefined,
        showDesktopPassword,
        (resource) => this.#distributions().source(resource),
        (resource, operationId) =>
          this.#distributions().release(resource, operationId),
      );
    }
  }

  #storageRoot(key: string): string {
    return path.join(this.root, "cloud-desktop-connections", key);
  }

  async #assertModelConnectionResolved(storageRoot: string): Promise<void> {
    if (
      await CloudModelConnections.blocksConnectionChange(
        storageRoot,
        this.safeStorage,
      )
    )
      throw new Error("CLOUD_MODEL_CONNECTION_UNRESOLVED");
  }

  get(webContentsId: number): CloudWindowEntry | undefined {
    return this.#entries.get(webContentsId);
  }

  isCloud(webContentsId: number): boolean {
    return this.#cloudIds.has(webContentsId);
  }

  async invoke(
    request: CloudDesktopConnectionRequest,
  ): Promise<
    | CloudDesktopConnectionMetadata
    | CloudGuestInstallationStatus
    | CloudGuestReleaseStatus
    | CloudGuestPreparationStatus
    | CloudArchiveDownloadResult
    | CloudArchiveRestoreResult
    | CloudReleaseBackupResult
    | CloudReleaseWithBackupResult
    | CloudModelConnectionStatus
    | { opened: true }
    | { deleted: boolean }
  > {
    if (
      request?.action === "prepareRuntimeRelease" ||
      request?.action === "runtimeReleaseStatus"
    ) {
      if (this.#stopping) throw new Error("cloud desktop windows are stopping");
      return request.action === "prepareRuntimeRelease"
        ? this.#distributions().prepare(request)
        : this.#distributions().status(request);
    }
    if (request?.action === "checkRuntimeRelease") {
      if (this.#stopping) throw new Error("cloud desktop windows are stopping");
      const version = app.getVersion();
      await probeCloudGuestRelease(version);
      return { kind: "guestRelease", available: true, version };
    }
    const resource = validateResource(request?.resource);
    const key = resourceKey(resource);
    const previous = this.#queues.get(key) ?? Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(() => this.#invoke(key, resource, request));
    this.#queues.set(key, operation);
    try {
      return await operation;
    } finally {
      if (this.#queues.get(key) === operation) this.#queues.delete(key);
    }
  }

  async #invoke(
    key: string,
    resource: CloudDesktopResource,
    request: Exclude<
      CloudDesktopConnectionRequest,
      | { action: "checkRuntimeRelease" }
      | { action: "prepareRuntimeRelease" | "runtimeReleaseStatus" }
    >,
  ) {
    if (this.#stopping) throw new Error("cloud desktop windows are stopping");
    const storageRoot = this.#storageRoot(key);
    const store = new ElectronSecureCredentialStore(
      storageRoot,
      this.safeStorage,
    );
    const existing = [...this.#entries.values()].find(
      (entry) => resourceKey(entry.context.resource) === key,
    );
    switch (request.action) {
      case "modelConnectionStatus":
      case "shareModelConnection":
      case "resumeModelConnection": {
        if (!this.requestCloudDesktop)
          throw new Error("CLOUD_MODEL_CONNECTION_FAILED");
        const owner = new CloudModelConnections(
          this.safeStorage,
          this.requestCloudDesktop,
        );
        if (request.action === "modelConnectionStatus")
          return owner.invoke(storageRoot, resource, null, request);
        if (await this.#installations?.blocksConnectionChange(key, resource))
          throw new Error("CLOUD_MODEL_CONNECTION_FAILED");
        const credential = await store.readCloudSessionCredential();
        if (!credential || credential.tenantId !== key)
          throw new Error("CLOUD_MODEL_CONNECTION_FAILED");
        const signal = this.#archiveAbort.signal;
        const remote = new AppServerRemoteConnection(async () => {
          signal.throwIfAborted();
          const current = await store.readCloudSessionCredential();
          if (
            !current ||
            current.token !== credential.token ||
            current.endpoint !== credential.endpoint ||
            current.tenantId !== key ||
            current.transport !== credential.transport
          )
            throw new Error("CLOUD_MODEL_CONNECTION_FAILED");
          const websocketUrl =
            credential.transport === "ecsTunnel"
              ? await resolveCloudDesktopTaskTunnel(
                  this.requestCloudDesktop!,
                  resource,
                  false,
                )
              : credential.endpoint;
          return {
            websocketUrl,
            authToken: credential.token,
            maxMessageBytes: 1024 * 1024,
          };
        });
        try {
          const session = await remote.connect({
            clientInfo: { name: "lime-model-connection", version: "1" },
          });
          return await owner.invoke(
            storageRoot,
            resource,
            credential,
            request,
            async (params) => {
              signal.throwIfAborted();
              const response =
                await session.connection.request<CloudDesktopResponse>(
                  session.client.request("cloud/desktop", params),
                  "cloud/desktop",
                  { timeoutMs: 60_000, signal },
                );
              return response.result;
            },
          );
        } catch {
          throw new Error("CLOUD_MODEL_CONNECTION_FAILED");
        } finally {
          await remote.stop();
        }
      }
      case "readReleaseBackup":
        return {
          kind: "releaseBackup" as const,
          backup: await this.#archiveBackups.read(storageRoot),
        };
      case "releaseWithBackup":
        if (!this.requestCloudDesktop)
          throw new Error("CLOUD_RELEASE_UNAVAILABLE");
        return this.#archiveBackups.release(
          storageRoot,
          { ...request, resource },
          this.requestCloudDesktop,
          this.#archiveAbort.signal,
        );
      case "downloadArchive":
      case "restoreArchiveToCloud": {
        const restore =
          request.action === "restoreArchiveToCloud"
            ? validateRestoreSelection(request)
            : undefined;
        const source =
          request.action === "restoreArchiveToCloud" && request.backupSource
            ? validateResource(request.backupSource)
            : undefined;
        const download =
          request.action === "downloadArchive"
            ? validateArchiveSelection(request)
            : undefined;
        const credential = await store.readCloudSessionCredential();
        if (
          !credential ||
          credential.tenantId !== key ||
          (download && !this.selectArchiveDestination) ||
          (restore && !this.requestCloudDesktop)
        )
          throw new Error("CLOUD_ARCHIVE_CONNECTION_REQUIRED");
        const destination = download
          ? await this.selectArchiveDestination?.()
          : undefined;
        if (download && !destination)
          return { kind: "archiveDownload" as const, canceled: true as const };
        const signal = this.#archiveAbort.signal;
        const remote = new AppServerRemoteConnection(async () => {
          signal.throwIfAborted();
          let websocketUrl = credential.endpoint;
          if (credential.transport === "ecsTunnel") {
            if (
              !this.requestCloudDesktop ||
              credential.endpoint !== ECS_APP_SERVER_TARGET
            )
              throw new Error("CLOUD_ARCHIVE_CONNECTION_REQUIRED");
            websocketUrl = await resolveCloudDesktopTaskTunnel(
              this.requestCloudDesktop,
              resource,
              false,
            );
          }
          return {
            websocketUrl,
            authToken: credential.token,
            maxMessageBytes: 1024 * 1024,
          };
        });
        try {
          const session = await remote.connect({
            clientInfo: { name: "lime-cloud-archive", version: "1" },
          });
          const callRemote: Parameters<typeof saveCloudArchive>[2] = async (
            params,
            timeoutMs = 30_000,
          ) => {
            const response =
              await session.connection.request<CloudDesktopResponse>(
                session.client.request("cloud/desktop", params),
                "cloud/desktop",
                { timeoutMs, signal },
              );
            return response.result;
          };
          if (restore && this.requestCloudDesktop) {
            const result = await restoreCloudArchive(
              restore,
              this.requestCloudDesktop,
              callRemote,
              signal,
            );
            if (!source) return result;
            const sourceRoot = this.#storageRoot(resourceKey(source));
            const original = await new ElectronSecureCredentialStore(
              sourceRoot,
              this.safeStorage,
            )
              .readCloudSessionCredential()
              .catch(() => null);
            if (
              original?.transport !== "ecsTunnel" &&
              credential.transport !== "ecsTunnel" &&
              original?.endpoint === credential.endpoint
            )
              return { ...result, releaseBackupRecorded: false };
            const releaseBackupRecorded = await this.#archiveBackups
              .markRestored(
                sourceRoot,
                source,
                resource,
                restore.expectedSha256,
              )
              .catch(() => false);
            return { ...result, releaseBackupRecorded };
          }
          if (download && destination) {
            const result = await saveCloudArchive(
              destination,
              download,
              callRemote,
              signal,
            );
            if (result.canceled) return result;
            const backupRecorded = await this.#archiveBackups
              .remember(storageRoot, result)
              .then(
                () => true,
                () => false,
              );
            return { ...result, backupRecorded };
          }
          throw new Error("CLOUD_ARCHIVE_CONNECTION_REQUIRED");
        } catch (error) {
          // Remote error text and connection details must not reach the UI.
          if (restore)
            throw new Error(
              error instanceof Error &&
                error.message === "CLOUD_ARCHIVE_RESTORE_INSPECT_FOLDER"
                ? error.message
                : "CLOUD_ARCHIVE_RESTORE_FAILED",
            );
          throw new Error("CLOUD_ARCHIVE_DOWNLOAD_FAILED");
        } finally {
          await remote.stop();
        }
      }
      case "installationStatus":
      case "installRuntime":
      case "reconnectRuntime":
      case "resumeInstallation":
      case "showDesktopPassword": {
        if (!this.#installations) throw new Error("CLOUD_INSTALL_UNAVAILABLE");
        if (request.action === "reconnectRuntime" && existing)
          throw new Error("CLOUD_INSTALL_CONNECTION_EXISTS");
        if (request.action === "reconnectRuntime") {
          await this.#assertModelConnectionResolved(storageRoot);
          const saved = await store.readCloudSessionCredential();
          if (
            saved &&
            (saved.transport !== "ecsTunnel" ||
              saved.tenantId !== key ||
              saved.endpoint !== ECS_APP_SERVER_TARGET)
          )
            throw new Error("CLOUD_INSTALL_CONNECTION_CHANGED");
        }
        if (
          request.action === "installRuntime" &&
          (existing || (await store.getCloudSessionCredentialMetadata()).exists)
        )
          throw new Error("CLOUD_INSTALL_CONNECTION_EXISTS");
        const status = await this.#installations.invoke(key, resource, request);
        if (request.action === "installationStatus" && !status.exists) {
          const metadata = await store.getCloudSessionCredentialMetadata();
          return { ...status, connectionSaved: metadata.exists };
        }
        return status.connectionSaved &&
          !(await store.getCloudSessionCredentialMetadata()).exists
          ? { ...status, connectionSaved: false }
          : status;
      }
      case "status":
        return store.getCloudSessionCredentialMetadata();
      case "save":
      case "saveEcsTunnel":
        await this.#assertModelConnectionResolved(storageRoot);
        if (await this.#installations?.blocksConnectionChange(key, resource))
          throw new Error("CLOUD_INSTALL_UNRESOLVED");
        if (existing)
          throw new Error(
            "close the cloud desktop window before changing its connection",
          );
        if (request.action === "saveEcsTunnel" && resource.provider !== "ecs")
          throw new Error(
            "Session Manager connections require an ECS resource",
          );
        return store.setCloudSessionCredential({
          tenantId: key,
          endpoint:
            request.action === "saveEcsTunnel"
              ? ECS_APP_SERVER_TARGET
              : request.endpoint,
          token: request.token,
          transport:
            request.action === "saveEcsTunnel" ? "ecsTunnel" : "direct",
        });
      case "delete":
        await this.#assertModelConnectionResolved(storageRoot);
        if (await this.#installations?.blocksConnectionChange(key, resource))
          throw new Error("CLOUD_INSTALL_UNRESOLVED");
        if (existing)
          throw new Error(
            "close the cloud desktop window before deleting its connection",
          );
        return store.deleteCloudSessionCredential();
      case "open": {
        if (await this.#installations?.blocksConnectionOpen(key, resource))
          throw new Error("CLOUD_INSTALL_UNRESOLVED");
        if (existing && !existing.window.isDestroyed()) {
          existing.window.show();
          existing.window.focus();
          return { opened: true as const };
        }
        const credential = await store.readCloudSessionCredential();
        if (!credential)
          throw new Error("cloud desktop connection is not configured");
        const endpoint = credential.endpoint;
        const transport = credential.transport ?? "direct";
        let attempted = false;
        // The token stays in Main and is read afresh only for an explicit connection attempt.
        const remote = new AppServerRemoteConnection(async () => {
          const current = await store.readCloudSessionCredential();
          if (
            !current ||
            current.tenantId !== key ||
            current.endpoint !== endpoint ||
            (current.transport ?? "direct") !== transport
          )
            throw new Error("cloud desktop connection changed");
          let websocketUrl = endpoint;
          if (transport === "ecsTunnel") {
            if (!this.requestCloudDesktop || endpoint !== ECS_APP_SERVER_TARGET)
              throw new Error("ECS task connection is unavailable");
            const renew = attempted;
            attempted = true;
            websocketUrl = await resolveCloudDesktopTaskTunnel(
              this.requestCloudDesktop,
              resource,
              renew,
            );
          }
          return { websocketUrl, authToken: current.token };
        });
        const host = new ElectronAppServerHost(null, null, remote);
        let atoms: PersistedAtomHost | undefined;
        let commands: ElectronHostCommands | undefined;
        let window: CloudWindow | undefined;
        try {
          await host.warmup();
          if (this.#stopping)
            throw new Error("cloud desktop windows are stopping");
          const context: CloudDesktopWindowContext = {
            kind: "cloud",
            resource,
            endpoint,
          };
          const namespace = createHash("sha256")
            .update(JSON.stringify([transport, endpoint]))
            .digest("hex");
          const uiRoot = path.join(storageRoot, "windows", namespace);
          const emit = (event: string, payload?: unknown) => {
            if (window && !window.isDestroyed())
              window.webContents.send(`evt:${event}`, { event, payload });
          };
          atoms = new PersistedAtomHost(uiRoot, emit);
          await atoms.ready;
          commands = new ElectronHostCommands(host, uiRoot, emit, uiRoot);
          window = this.createWindow(
            context,
            `persist:cloud-${key}-${namespace}`,
          );
          const entry: CloudWindowEntry = {
            context,
            host,
            atoms,
            commands,
            window,
          };
          this.#entries.set(window.webContents.id, entry);
          const contentsId = window.webContents.id;
          this.#cloudIds.add(contentsId);
          window.once("closed", () => {
            this.#entries.delete(contentsId);
            entry.atoms.dispose();
            entry.commands.dispose();
            void entry.host.stop().catch(() => undefined);
          });
          return { opened: true as const };
        } catch (error) {
          atoms?.dispose();
          commands?.dispose();
          window?.close();
          await host.stop();
          if (transport === "ecsTunnel")
            await this.requestCloudDesktop?.({
              action: "closeEcsTunnel",
              resource,
              channel: "appServer",
            }).catch(() => undefined);
          throw error;
        }
      }
      default:
        throw new Error("unsupported cloud desktop connection action");
    }
  }

  status(entry: CloudWindowEntry): CloudDesktopWindowStatus {
    const diagnostics = entry.host.getDiagnostics();
    return {
      ...entry.context,
      connected: diagnostics.connected,
      generation: diagnostics.connection_generation,
    };
  }

  async invokeWindow(
    entry: CloudWindowEntry,
    command: string,
    args?: Record<string, unknown>,
  ): Promise<unknown> {
    if (!isCloudWindowHostCommand(command))
      throw new Error(
        "local host capability is unavailable in a cloud desktop window",
      );
    const request = args?.request;
    switch (command) {
      case "cloud_desktop_window_status":
        return this.status(entry);
      case "cloud_desktop_window_reconnect":
        await entry.host.recoverAfterSystemResume();
        return this.status(entry);
      case "cloud_desktop_window_view": {
        const resource = entry.context.resource;
        const active = () =>
          !this.#stopping &&
          this.#entries.get(entry.window.webContents.id) === entry &&
          !entry.window.isDestroyed();
        if (!active() || resource.provider !== "ecs")
          throw new Error("CLOUD_DESKTOP_VIEW_UNAVAILABLE");
        const action = (request as { action?: unknown } | undefined)?.action;
        if (action === "showPassword") {
          if (!this.#installations)
            throw new Error("CLOUD_DESKTOP_PASSWORD_UNAVAILABLE");
          try {
            await this.#installations.invoke(resourceKey(resource), resource, {
              action: "showDesktopPassword",
              resource,
            });
          } catch {
            throw new Error("CLOUD_DESKTOP_PASSWORD_UNAVAILABLE");
          }
          return { shown: true };
        }
        if (action !== "connect" || !this.requestCloudDesktop)
          throw new Error("CLOUD_DESKTOP_VIEW_UNAVAILABLE");
        const endpoint = await resolveCloudDesktopViewTunnel(
          this.requestCloudDesktop,
          resource,
        );
        if (!active()) throw new Error("CLOUD_DESKTOP_VIEW_UNAVAILABLE");
        allowCloudDesktopView(entry.window.webContents, endpoint);
        return { endpoint };
      }
      case "app_server_handle_json_lines":
        return entry.host.handleJsonLines(
          (request ?? { lines: [] }) as { lines: string[] },
          { ownerWebContentsId: entry.window.webContents.id },
        );
      case "app_server_drain_events":
        return entry.host.drainEvents(
          (request ?? {}) as { includeRecent?: boolean; limit?: number },
        );
      case "persisted_atom_read":
        return entry.atoms.sendPersistedAtomState(args);
      case "persisted_atom_update":
        return entry.atoms.updatePersistedAtomState(args);
      default:
        return entry.commands.invoke(command, args);
    }
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    this.#archiveAbort.abort();
    await this.#release?.stop();
    await Promise.allSettled([...this.#queues.values()]);
    await this.#installations?.stop();
    await this.#distribution?.stop();
    await Promise.allSettled(
      [...this.#entries.values()].map(async (entry) => {
        entry.atoms.dispose();
        entry.commands.dispose();
        await entry.host.stop();
      }),
    );
    this.#entries.clear();
  }
}

function validateResource(value: CloudDesktopResource): CloudDesktopResource {
  if (!value || !["ecs", "wuying"].includes(value.provider))
    throw new Error("invalid cloud desktop resource");
  for (const name of ["profile", "regionId", "resourceId"] as const) {
    if (
      typeof value[name] !== "string" ||
      !value[name].trim() ||
      value[name].length > 256 ||
      [...value[name]].some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    )
      throw new Error("invalid cloud desktop resource");
  }
  return {
    provider: value.provider,
    profile: value.profile,
    regionId: value.regionId,
    resourceId: value.resourceId,
  };
}
function resourceKey(resource: CloudDesktopResource): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        resource.provider,
        resource.profile,
        resource.regionId,
        resource.resourceId,
      ]),
    )
    .digest("hex");
}
