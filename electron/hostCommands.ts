/* global process */
import { app } from "./electronRuntime";
import {
  BrowserExtensionStore,
  listBrowserExtensions,
  loadBrowserExtension,
  removeBrowserExtension,
} from "./browserExtensionsHost";
import { BrowserPasswordStore } from "./browserPasswordStore";
import { AutofillPreferencesStore } from "./autofillPreferencesStore";
import { ContactAutofillStore } from "./contactAutofillStore";
import { openEmbeddedBrowserSession } from "./embeddedBrowserSession";
import type { SafeStorageLike } from "./secureCredentialStore";
import {
  appendSshConnection,
  ensureSshConfig,
  parseSshConfig,
  removeSshConnection,
  updateSshConnection,
} from "./sshConnectionsHost";
import {
  METHOD_CONFIG_READ,
  METHOD_MODEL_LIST,
  METHOD_MODEL_PROVIDER_LIST,
  METHOD_WORKSPACE_BY_PATH_READ,
  METHOD_WORKSPACE_DEFAULT_ENSURE,
  METHOD_WORKSPACE_DEFAULT_READ,
  METHOD_WORKSPACE_ENSURE,
  METHOD_WORKSPACE_ENSURE_READY,
  METHOD_WORKSPACE_LIST,
  METHOD_WORKSPACE_PROJECTS_ROOT_READ,
  METHOD_WORKSPACE_PROJECT_PATH_RESOLVE,
  METHOD_WORKSPACE_READ,
  decodeModelRouteSelector,
  type Model,
  type ConfigReadResponse,
  type ModelListResponse,
  type ModelProviderListResponse,
  type WorkspaceEnsureProjectResponse,
  type WorkspaceEnsureReadyResponse,
  type WorkspaceListResponse,
  type WorkspaceProjectPathResolveResponse,
  type WorkspaceProjectsRootReadResponse,
  type WorkspaceReadResponse,
} from "@limecloud/app-server-client";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ElectronAppServerHost } from "./appServerHost";
import { resolveCurrentDesktopStorageRoots } from "./appDataPaths";
import { importCodexSkills } from "./externalAgentImport";
import { readCodexSettings } from "./codexSettingsImport";
import { listCodexChats, readCodexChat } from "./codexChatImport";
import { listAppSnapshotWindows } from "./appSnapshotHost";
import { showDesktopNotification } from "./desktopNotificationHost";
import { FileShellHost } from "./fileShellHost";
import { LayeredDesignProjectHost } from "./layeredDesignProjectHost";
import { SystemUtilityHost } from "./systemUtilityHost";
import { VoiceModelHost } from "./voiceModelHost";
import type {
  CloudSessionCredential,
  SecureCredentialStore,
} from "./secureCredentialStore";

type HostArgs = Record<string, unknown> | null | undefined;
type AppServerParams = Record<string, unknown>;
type HostEventEmitter = (event: string, payload?: unknown) => void;
export class ElectronHostCommands {
  readonly #appServerHost: ElectronAppServerHost;
  readonly #fileShellHost: FileShellHost;
  readonly #layeredDesignProjectHost = new LayeredDesignProjectHost();
  readonly #systemUtilityHost: SystemUtilityHost;
  readonly #voiceModelHost: VoiceModelHost;
  readonly #browserExtensionsStore: BrowserExtensionStore;
  readonly #browserPasswordStore: BrowserPasswordStore;
  readonly #contactAutofillStore: ContactAutofillStore;
  readonly #autofillPreferencesStore: AutofillPreferencesStore;
  readonly #secureCredentialStore: SecureCredentialStore | null;

  constructor(
    appServerHost: ElectronAppServerHost,
    userDataDir = app.getPath("userData"),
    emit: HostEventEmitter = () => undefined,
    appDataRoot = resolveCurrentDesktopStorageRoots(userDataDir).appDataRoot,
    secureCredentialStore: SecureCredentialStore | null = null,
    credentialEncryption: SafeStorageLike | null = null,
  ) {
    this.#appServerHost = appServerHost;
    this.#secureCredentialStore = secureCredentialStore;
    this.#systemUtilityHost = new SystemUtilityHost({
      appDataRoot,
      emit,
    });
    this.#fileShellHost = new FileShellHost({
      appDataRoot,
      nativeQuery: (args) =>
        this.#systemUtilityHost.invokeMacOSNativeHost(args),
    });
    this.#voiceModelHost = new VoiceModelHost(appDataRoot, emit);
    this.#browserExtensionsStore = new BrowserExtensionStore(
      path.join(appDataRoot, "browser-extensions.json"),
    );
    this.#browserPasswordStore = new BrowserPasswordStore(
      path.join(appDataRoot, "browser-passwords.json"),
      credentialEncryption,
    );
    this.#contactAutofillStore = new ContactAutofillStore(
      path.join(appDataRoot, "contact-autofill.json"),
    );
    this.#autofillPreferencesStore = new AutofillPreferencesStore(
      path.join(appDataRoot, "browser-autofill.json"),
    );
  }

  async invoke(command: string, args?: HostArgs): Promise<unknown> {
    switch (command) {
      case "is_default_browser":
        return this.#systemUtilityHost.isDefaultBrowser();
      case "open_external_url":
        return await this.#systemUtilityHost.openExternalUrl(args);
      case "open_file_preview_window":
        return await this.#fileShellHost.openFilePreviewWindow(args);
      case "open_system_settings_url":
        return await this.#systemUtilityHost.openSystemSettingsUrl(args);
      case "macos_native_host_invoke":
        return await this.#systemUtilityHost.invokeMacOSNativeHost(args);
      case "windows_native_host_invoke":
        return await this.#systemUtilityHost.invokeWindowsNativeHost(args);
      case "show_desktop_notification":
        return showDesktopNotification(args);
      case "list_app_snapshot_windows":
        return listAppSnapshotWindows();
      case "read_codex_settings":
        return readCodexSettings();
      case "import_codex_skills":
        return importCodexSkills();
      case "list_codex_chats": {
        const record = toRecord(args) ?? {};
        return await listCodexChats({
          limit: typeof record.limit === "number" ? record.limit : undefined,
        });
      }
      case "read_codex_chat": {
        const record = toRecord(args) ?? {};
        return await readCodexChat({
          sourcePath: readRequiredString(record, "sourcePath"),
        });
      }
      case "reveal_in_finder":
        return this.#fileShellHost.revealInFinder(args);
      case "open_in_get_targets":
        return this.#fileShellHost.getTargets(args);
      case "open_in_detect_target":
        return this.#fileShellHost.detectTarget(args);
      case "open_in_load_target_icon":
        return this.#fileShellHost.loadTargetIcon(args);
      case "open_in_open":
        return this.#fileShellHost.open(args);
      case "open_in_set_global_preferred_target":
        return this.#fileShellHost.setGlobalPreferredTarget(args);
      case "save_exported_document":
        return await this.#saveExportedDocument(args);
      case "save_layered_design_project_export":
        return await this.#layeredDesignProjectHost.saveExport(args);
      case "read_layered_design_project_export":
        return await this.#layeredDesignProjectHost.readExport(args);
      case "recognize_layered_design_text":
        return this.#layeredDesignProjectHost.recognizeText(args);
      case "analyze_layered_design_flat_image":
        return this.#layeredDesignProjectHost.analyzeFlatImage(args);
      case "browser_extensions_list": {
        const extensions = await listBrowserExtensions(
          openEmbeddedBrowserSession(),
        );
        const disabled = (await this.#browserExtensionsStore.read())
          .filter((entry) => entry.enabled === false)
          .map((entry) => ({
            id: entry.id,
            name: entry.name ?? entry.path,
            version: entry.version ?? "",
            manifestVersion: null,
            path: entry.path,
            enabled: false,
          }));
        return [...extensions, ...disabled];
      }
      case "browser_extensions_load": {
        const extension = await loadBrowserExtension(
          openEmbeddedBrowserSession(),
          readRequiredString(toRecord(args) ?? {}, "path"),
        );
        await this.#browserExtensionsStore.add({
          id: extension.id,
          path: extension.path,
          name: extension.name,
          version: extension.version,
          enabled: true,
        });
        return extension;
      }
      case "browser_extensions_set_enabled": {
        const record = toRecord(args) ?? {};
        const id = readRequiredString(record, "id");
        const enabled = record.enabled;
        if (typeof enabled !== "boolean") {
          throw new Error("Invalid extension enabled flag");
        }
        const session = openEmbeddedBrowserSession();
        if (enabled) {
          const stored = await this.#browserExtensionsStore.find(id);
          if (!stored) throw new Error("扩展不存在");
          const extension = await loadBrowserExtension(session, stored.path);
          await this.#browserExtensionsStore.add({
            id: extension.id,
            path: extension.path,
            name: extension.name,
            version: extension.version,
            enabled: true,
          });
          return extension;
        }
        try {
          removeBrowserExtension(session, id);
        } catch {
          // 已禁用的扩展可能未被加载。
        }
        await this.#browserExtensionsStore.setEnabled(id, false);
        const stored = await this.#browserExtensionsStore.find(id);
        if (!stored) throw new Error("扩展不存在");
        return {
          id: stored.id,
          name: stored.name ?? stored.path,
          version: stored.version ?? "",
          manifestVersion: null,
          path: stored.path,
          enabled: false,
        };
      }
      case "browser_extensions_remove": {
        const id = readRequiredString(toRecord(args) ?? {}, "id");
        const removed = removeBrowserExtension(
          openEmbeddedBrowserSession(),
          id,
        );
        await this.#browserExtensionsStore.remove(id);
        return removed;
      }
      case "get_home_dir":
        return this.#fileShellHost.getHomeDir();
      case "ssh_config_ensure":
        return ensureSshConfig(app.getPath("home"));
      case "ssh_connection_add": {
        const record = toRecord(args) ?? {};
        const port = record.port;
        if (
          port !== undefined &&
          (typeof port !== "number" || !Number.isInteger(port))
        ) {
          throw new Error("Invalid SSH port");
        }
        const user = readString(record, "user") ?? undefined;
        return await appendSshConnection(app.getPath("home"), {
          alias: readRequiredString(record, "alias"),
          hostName: readRequiredString(record, "hostName"),
          ...(user ? { user } : {}),
          ...(port !== undefined ? { port } : {}),
        });
      }
      case "browser_autofill_get":
        return await this.#autofillPreferencesStore.read();
      case "browser_autofill_set": {
        const enabled = toRecord(args)?.enabled;
        if (typeof enabled !== "boolean") {
          throw new Error("Invalid autofill enabled flag");
        }
        return await this.#autofillPreferencesStore.set(enabled);
      }
      case "browser_contact_profile_read":
        return await this.#contactAutofillStore.read();
      case "browser_contact_profile_clear":
        await this.#contactAutofillStore.clear();
        return true;
      case "browser_contact_profile_save": {
        const record = toRecord(args) ?? {};
        return await this.#contactAutofillStore.save({
          fullName: readString(record, "fullName") ?? "",
          email: readString(record, "email") ?? "",
          phone: readString(record, "phone") ?? "",
          address: readString(record, "address") ?? "",
        });
      }
      case "browser_passwords_list":
        return await this.#browserPasswordStore.list();
      case "browser_passwords_save": {
        const record = toRecord(args) ?? {};
        return await this.#browserPasswordStore.save({
          origin: readRequiredString(record, "origin"),
          username: readRequiredString(record, "username"),
          password: readRequiredString(record, "password"),
        });
      }
      case "browser_passwords_remove":
        return await this.#browserPasswordStore.remove(
          readRequiredString(toRecord(args) ?? {}, "id"),
        );
      case "browser_passwords_reveal":
        return await this.#browserPasswordStore.reveal(
          readRequiredString(toRecord(args) ?? {}, "id"),
        );
      case "ssh_connection_update": {
        const record = toRecord(args) ?? {};
        const port = record.port;
        if (
          port !== undefined &&
          (typeof port !== "number" || !Number.isInteger(port))
        ) {
          throw new Error("Invalid SSH port");
        }
        const user = readString(record, "user") ?? undefined;
        return await updateSshConnection(
          app.getPath("home"),
          readRequiredString(record, "alias"),
          {
            hostName: readRequiredString(record, "hostName"),
            ...(user ? { user } : {}),
            ...(port !== undefined ? { port } : {}),
          },
        );
      }
      case "ssh_connection_remove":
        return await removeSshConnection(
          app.getPath("home"),
          readRequiredString(toRecord(args) ?? {}, "alias"),
        );
      case "ssh_connections_list": {
        const configPath = path.join(app.getPath("home"), ".ssh", "config");
        try {
          return parseSshConfig(await readFile(configPath, "utf8"));
        } catch {
          return [];
        }
      }
      case "get_file_icon_data_url":
        return await this.#fileShellHost.getFileIconDataUrl(args);
      case "get_runtime_provider_selection":
        return await this.#getRuntimeProviderSelection();
      case "get_default_provider":
        return await this.#getDefaultProvider();
      case "workspace_list":
        return await this.#listWorkspaces();
      case "workspace_get_default":
        return await this.#readDefaultWorkspace();
      case "get_or_create_default_project":
        return await this.#ensureDefaultWorkspace();
      case "workspace_get":
        return await this.#readWorkspace(args);
      case "workspace_get_by_path":
        return await this.#readWorkspaceByPath(args);
      case "workspace_ensure":
        return await this.#ensureWorkspace(args);
      case "workspace_get_projects_root":
        return await this.#readWorkspaceProjectsRoot();
      case "workspace_resolve_project_path":
        return await this.#resolveWorkspaceProjectPath(args);
      case "workspace_ensure_default_ready":
        return await this.#ensureDefaultWorkspaceReady();
      case "workspace_ensure_ready":
        return await this.#ensureWorkspaceReady(args);
      case "voice_models_list_catalog":
        return this.#voiceModelHost.listCatalog();
      case "voice_models_get_install_state":
        return await this.#voiceModelHost.getInstallState(args);
      case "voice_models_download":
        return await this.#voiceModelHost.download(args);
      case "voice_models_delete":
        return await this.#voiceModelHost.delete(args);
      case "report_frontend_debug_log":
        this.#reportFrontendDebugLog(args);
        return null;
      case "app_server_host_diagnostics":
        return this.#appServerHost.getDiagnostics();
      case "cloud_session_credential_set":
        return await this.#setCloudSessionCredential(args);
      case "cloud_session_credential_status":
        return await this.#requireSecureCredentialStore().getCloudSessionCredentialMetadata();
      case "cloud_session_credential_delete":
        return await this.#requireSecureCredentialStore().deleteCloudSessionCredential();
      case "report_frontend_crash":
        this.#reportFrontendCrash(args);
        return { success: true };
      default:
        throw new Error(`Electron host command is not implemented: ${command}`);
    }
  }

  dispose(): void {
    this.#systemUtilityHost.dispose();
  }

  async #appServerRequest<T>(
    method: string,
    params: AppServerParams = {},
  ): Promise<T> {
    return await this.#appServerHost.request<T>(method, params);
  }

  async #saveExportedDocument(args: HostArgs): Promise<null> {
    const request = readRequest(args);
    const targetPath = readRequiredString(request, "filePath");
    const content = readRequiredRawString(request, "content");
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content, "utf8");
    return null;
  }

  async #getRuntimeProviderSelection(): Promise<{
    provider_configured: boolean;
    provider_name?: string;
    provider_selector?: string;
    model_name?: string;
  }> {
    const [config, providers, models] = await Promise.all([
      this.#readConfig().catch(() => ({ default_provider: "openai" })),
      this.#listModelProviders().catch(() => []),
      this.#listModels().catch(() => []),
    ]);
    const defaultProvider = resolveCurrentDefaultProvider(
      config.default_provider,
      providers,
    );
    const configuredDefaultProvider = findProvider(providers, defaultProvider);
    const selectedProvider =
      (configuredDefaultProvider &&
      isConfiguredProvider(configuredDefaultProvider)
        ? configuredDefaultProvider
        : null) ??
      providers.find(isConfiguredProvider) ??
      configuredDefaultProvider;
    const selectedProviderId =
      readString(selectedProvider, "id")?.trim() ?? defaultProvider.trim();
    const normalizedSelectedProviderId =
      normalizeProviderIdentity(selectedProviderId);
    const selectedModel = selectedProviderId
      ? models.find((model) => {
          const providerId = normalizeProviderIdentity(
            decodeModelRouteSelector(model.id)?.providerId,
          );
          return providerId === normalizedSelectedProviderId;
        })
      : undefined;
    const modelName = selectedModel?.model;

    return {
      provider_configured: selectedProvider
        ? isConfiguredProvider(selectedProvider)
        : false,
      provider_name: readString(selectedProvider, "name") ?? selectedProviderId,
      provider_selector: selectedProviderId || undefined,
      model_name: modelName ?? undefined,
    };
  }

  async #getDefaultProvider(): Promise<string> {
    const [config, providers] = await Promise.all([
      this.#readConfig(),
      this.#listModelProviders(),
    ]);
    return resolveCurrentDefaultProvider(config.default_provider, providers);
  }

  async #listModelProviders(): Promise<unknown[]> {
    const response = await this.#appServerRequest<ModelProviderListResponse>(
      METHOD_MODEL_PROVIDER_LIST,
    );
    return response.providers ?? [];
  }

  async #listModels(
    params: AppServerParams = { includeHidden: true },
  ): Promise<Model[]> {
    const models: Model[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    do {
      const response: ModelListResponse =
        await this.#appServerRequest<ModelListResponse>(METHOD_MODEL_LIST, {
          ...params,
          ...(cursor ? { cursor } : {}),
        });
      models.push(...response.data);
      cursor = response.nextCursor ?? null;
      if (cursor && seenCursors.has(cursor)) {
        throw new Error(`model/list repeated cursor: ${cursor}`);
      }
      if (cursor) {
        seenCursors.add(cursor);
      }
    } while (cursor);
    return models;
  }

  async #listWorkspaces(): Promise<unknown[]> {
    const response = await this.#appServerRequest<WorkspaceListResponse>(
      METHOD_WORKSPACE_LIST,
    );
    return response.workspaces;
  }

  async #readWorkspace(args: HostArgs): Promise<unknown | null> {
    const request = readRequest(args);
    const id = readString(request, "id") ?? readString(args, "id");
    if (!id) {
      return null;
    }
    const response = await this.#appServerRequest<WorkspaceReadResponse>(
      METHOD_WORKSPACE_READ,
      { id },
    );
    return response.workspace ?? null;
  }

  async #readWorkspaceByPath(args: HostArgs): Promise<unknown | null> {
    const request = readRequest(args);
    const rootPath =
      readString(request, "rootPath") ??
      readString(request, "root_path") ??
      readString(args, "rootPath") ??
      readString(args, "root_path");
    if (!rootPath) {
      return null;
    }
    const response = await this.#appServerRequest<WorkspaceReadResponse>(
      METHOD_WORKSPACE_BY_PATH_READ,
      { rootPath },
    );
    return response.workspace ?? null;
  }

  async #readDefaultWorkspace(): Promise<unknown | null> {
    const response = await this.#appServerRequest<WorkspaceReadResponse>(
      METHOD_WORKSPACE_DEFAULT_READ,
    );
    return response.workspace ?? null;
  }

  async #ensureDefaultWorkspace(): Promise<unknown> {
    const response = await this.#appServerRequest<WorkspaceReadResponse>(
      METHOD_WORKSPACE_DEFAULT_ENSURE,
    );
    if (!response.workspace) {
      throw new Error("workspace/default/ensure returned no workspace");
    }
    return response.workspace;
  }

  async #readWorkspaceProjectsRoot(): Promise<string> {
    const response =
      await this.#appServerRequest<WorkspaceProjectsRootReadResponse>(
        METHOD_WORKSPACE_PROJECTS_ROOT_READ,
      );
    return response.rootPath;
  }

  async #resolveWorkspaceProjectPath(args: HostArgs): Promise<string> {
    const request = readRequest(args);
    const name =
      readString(request, "name") ?? readString(args, "name") ?? "untitled";
    const parentRootPath =
      readString(request, "parentRootPath") ??
      readString(request, "parent_root_path") ??
      readString(args, "parentRootPath") ??
      readString(args, "parent_root_path");
    const response =
      await this.#appServerRequest<WorkspaceProjectPathResolveResponse>(
        METHOD_WORKSPACE_PROJECT_PATH_RESOLVE,
        {
          name,
          ...(parentRootPath ? { parentRootPath } : {}),
        },
      );
    return response.rootPath;
  }

  async #ensureWorkspace(args: HostArgs): Promise<unknown> {
    const request = readRequest(args);
    const name =
      readString(request, "name") ?? readString(args, "name") ?? "untitled";
    const rootPath =
      readString(request, "rootPath") ??
      readString(request, "root_path") ??
      readString(args, "rootPath") ??
      readString(args, "root_path");
    if (!rootPath) {
      throw new Error("workspace_ensure requires rootPath");
    }
    const workspaceType =
      readString(request, "workspaceType") ??
      readString(request, "workspace_type") ??
      readString(args, "workspaceType") ??
      readString(args, "workspace_type");
    const response =
      await this.#appServerRequest<WorkspaceEnsureProjectResponse>(
        METHOD_WORKSPACE_ENSURE,
        {
          name,
          rootPath,
          ...(workspaceType ? { workspaceType } : {}),
        },
      );
    return response.workspace;
  }

  async #ensureDefaultWorkspaceReady(): Promise<unknown | null> {
    const workspace = await this.#ensureDefaultWorkspace();
    const id = readString(workspace, "id");
    if (!id) {
      return null;
    }
    const response = await this.#appServerRequest<WorkspaceEnsureReadyResponse>(
      METHOD_WORKSPACE_ENSURE_READY,
      { id },
    );
    return response.result;
  }

  async #ensureWorkspaceReady(args: HostArgs): Promise<unknown> {
    const request = readRequest(args);
    const id = readString(request, "id") ?? readString(args, "id");
    if (!id) {
      throw new Error("workspace_ensure_ready requires id");
    }
    const response = await this.#appServerRequest<WorkspaceEnsureReadyResponse>(
      METHOD_WORKSPACE_ENSURE_READY,
      { id },
    );
    return response.result;
  }

  async #readConfig(): Promise<Record<string, unknown>> {
    const response = await this.#appServerRequest<ConfigReadResponse>(
      METHOD_CONFIG_READ,
      {},
    );
    if (
      !response.config ||
      typeof response.config !== "object" ||
      Array.isArray(response.config)
    ) {
      throw new Error("config/read returned invalid Desktop config");
    }
    return response.config as Record<string, unknown>;
  }

  #reportFrontendDebugLog(args: HostArgs): void {
    const report = readRecord(args, "report");
    const level = readString(report, "level") ?? "info";
    const message = readString(report, "message") ?? "";
    safeWriteElectronHostLog("log", `[electron-renderer:${level}] ${message}`);
  }

  #reportFrontendCrash(args: HostArgs): void {
    const report = readRecord(args, "report") ?? {};
    const message = readString(report, "message") ?? "renderer crash report";
    safeWriteElectronHostLog(
      "error",
      "[electron-renderer:crash]",
      message,
      report,
    );
  }

  async #setCloudSessionCredential(args: HostArgs): Promise<unknown> {
    const request = readRequest(args);
    const credential: CloudSessionCredential = {
      tenantId:
        readString(request, "tenantId") ??
        readString(request, "tenant_id") ??
        readRequiredString(request, "tenantId"),
      endpoint:
        readString(request, "endpoint") ??
        readRequiredString(request, "endpoint"),
      token: readRequiredRawString(request, "token"),
    };
    return await this.#requireSecureCredentialStore().setCloudSessionCredential(
      credential,
    );
  }

  #requireSecureCredentialStore(): SecureCredentialStore {
    if (!this.#secureCredentialStore) {
      throw new Error("secure credential storage is not configured");
    }
    return this.#secureCredentialStore;
  }
}

function readRecord(
  value: unknown,
  key: string,
): Record<string, unknown> | null {
  const record = toRecord(value);
  if (!record) {
    return null;
  }
  const next = record[key];
  return next && typeof next === "object" && !Array.isArray(next)
    ? (next as Record<string, unknown>)
    : null;
}

function readRequest(value: unknown): Record<string, unknown> {
  return readRecord(value, "request") ?? toRecord(value) ?? {};
}

function readString(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const next = (value as Record<string, unknown>)[key];
  return typeof next === "string" && next.trim() ? next.trim() : null;
}

function readRequiredString(value: unknown, key: string): string {
  const next = readString(value, key);
  if (!next) {
    throw new Error(`Missing required string field: ${key}`);
  }
  return next;
}

function readRequiredRawString(value: unknown, key: string): string {
  const record = toRecord(value);
  const next = record?.[key];
  if (typeof next !== "string") {
    throw new Error(`Missing required string field: ${key}`);
  }
  return next;
}

function findProvider(
  providers: unknown[],
  providerId: string,
): Record<string, unknown> | null {
  const normalizedProviderId = normalizeProviderIdentity(providerId);
  if (!normalizedProviderId) {
    return null;
  }
  return (
    (providers.find((provider) => {
      const record = toRecord(provider);
      const id = normalizeProviderIdentity(readString(record, "id"));
      const name = normalizeProviderIdentity(readString(record, "name"));
      return (
        record && (id === normalizedProviderId || name === normalizedProviderId)
      );
    }) as Record<string, unknown> | undefined) ?? null
  );
}

function normalizeProviderIdentity(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function resolveCurrentDefaultProvider(
  value: unknown,
  providers: unknown[],
): string {
  if (typeof value !== "string") {
    return readString(providers.find(isConfiguredProvider), "id") ?? "";
  }
  const provider = value.trim();
  const configuredProvider = findProvider(providers, provider);
  if (configuredProvider && isConfiguredProvider(configuredProvider)) {
    return readString(configuredProvider, "id") ?? provider;
  }
  return readString(providers.find(isConfiguredProvider), "id") ?? "";
}

function isConfiguredProvider(
  provider: unknown,
): provider is Record<string, unknown> {
  const record = toRecord(provider);
  if (!record) {
    return false;
  }
  const enabled = record.enabled !== false;
  const apiKeyCount = record.api_key_count;
  return enabled && typeof apiKeyCount === "number" && apiKeyCount > 0;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

type ElectronHostLogMethod = "log" | "error";
const CLOSED_OUTPUT_STREAM_ERROR_HANDLER_INSTALLED = Symbol.for(
  "lime.electron.hostCommands.closedOutputStreamErrorHandlerInstalled",
);

type ElectronHostOutputStream = {
  [CLOSED_OUTPUT_STREAM_ERROR_HANDLER_INSTALLED]?: boolean;
  on?: (event: "error", listener: (error: unknown) => void) => unknown;
};

function safeWriteElectronHostLog(
  method: ElectronHostLogMethod,
  ...args: unknown[]
): void {
  try {
    console[method](...args);
  } catch (error) {
    if (!isClosedOutputStreamError(error)) {
      throw error;
    }
  }
}

function installClosedOutputStreamErrorHandler(stream: unknown): void {
  if (!stream || typeof stream !== "object") {
    return;
  }

  const outputStream = stream as ElectronHostOutputStream;
  if (
    outputStream[CLOSED_OUTPUT_STREAM_ERROR_HANDLER_INSTALLED] ||
    typeof outputStream.on !== "function"
  ) {
    return;
  }

  Object.defineProperty(
    outputStream,
    CLOSED_OUTPUT_STREAM_ERROR_HANDLER_INSTALLED,
    {
      value: true,
    },
  );
  outputStream.on("error", (error: unknown) => {
    if (!isClosedOutputStreamError(error)) {
      throw error;
    }
  });
}

function isClosedOutputStreamError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = "code" in error ? String(error.code) : "";
  return (
    code === "EPIPE" ||
    code === "ERR_STREAM_DESTROYED" ||
    code === "ERR_STREAM_WRITE_AFTER_END"
  );
}

installClosedOutputStreamErrorHandler(process.stdout);
installClosedOutputStreamErrorHandler(process.stderr);
