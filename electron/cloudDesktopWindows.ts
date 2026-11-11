import { createHash } from "node:crypto";
import path from "node:path";
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
} from "../src/lib/desktop-host/cloudDesktopConnection";
import { ElectronAppServerHost } from "./appServerHost";
import { AppServerRemoteConnection } from "./appServerRemoteConnection";
import {
  ECS_APP_SERVER_TARGET,
  resolveCloudDesktopTaskTunnel,
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
import {
  saveCloudArchive,
  validateArchiveSelection,
} from "./cloudArchiveDownload";
import {
  restoreCloudArchive,
  validateRestoreSelection,
} from "./cloudArchiveRestore";

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
    if (requestCloudDesktop && selectArtifact) {
      this.#installations = new CloudGuestInstallations(
        root,
        safeStorage,
        requestCloudDesktop,
        selectArtifact,
        async (resource, token) => {
          const key = resourceKey(resource);
          const store = new ElectronSecureCredentialStore(
            path.join(root, "cloud-desktop-connections", key),
            safeStorage,
          );
          const existing = await store.readCloudSessionCredential();
          if (
            existing &&
            (existing.token !== token ||
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
      );
    }
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
    | CloudArchiveDownloadResult
    | CloudArchiveRestoreResult
    | { opened: true }
    | { deleted: boolean }
  > {
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
    request: CloudDesktopConnectionRequest,
  ) {
    if (this.#stopping) throw new Error("cloud desktop windows are stopping");
    const storageRoot = path.join(this.root, "cloud-desktop-connections", key);
    const store = new ElectronSecureCredentialStore(
      storageRoot,
      this.safeStorage,
    );
    const existing = [...this.#entries.values()].find(
      (entry) => resourceKey(entry.context.resource) === key,
    );
    switch (request.action) {
      case "downloadArchive":
      case "restoreArchiveToCloud": {
        const restore =
          request.action === "restoreArchiveToCloud"
            ? validateRestoreSelection(request)
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
          if (restore && this.requestCloudDesktop)
            return await restoreCloudArchive(
              restore,
              this.requestCloudDesktop,
              callRemote,
              signal,
            );
          if (download && destination)
            return await saveCloudArchive(
              destination,
              download,
              callRemote,
              signal,
            );
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
      case "resumeInstallation":
      case "showDesktopPassword": {
        if (!this.#installations) throw new Error("CLOUD_INSTALL_UNAVAILABLE");
        if (
          request.action === "installRuntime" &&
          (existing || (await store.getCloudSessionCredentialMetadata()).exists)
        )
          throw new Error("CLOUD_INSTALL_CONNECTION_EXISTS");
        const status = await this.#installations.invoke(key, resource, request);
        return status.connectionSaved &&
          !(await store.getCloudSessionCredentialMetadata()).exists
          ? { ...status, connectionSaved: false }
          : status;
      }
      case "status":
        return store.getCloudSessionCredentialMetadata();
      case "save":
      case "saveEcsTunnel":
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
        if (await this.#installations?.blocksConnectionChange(key, resource))
          throw new Error("CLOUD_INSTALL_UNRESOLVED");
        if (existing)
          throw new Error(
            "close the cloud desktop window before deleting its connection",
          );
        return store.deleteCloudSessionCredential();
      case "open": {
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
    await Promise.allSettled([...this.#queues.values()]);
    await this.#installations?.stop();
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
