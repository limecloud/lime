import { safeInvoke, safeListen } from "@/lib/dev-bridge";

export type OpenClawGatewayStatus =
  | "stopped"
  | "starting"
  | "running"
  | "error";

export interface OpenClawBinaryInstallStatus {
  installed: boolean;
  path?: string | null;
}

export interface OpenClawBinaryAvailabilityStatus {
  available: boolean;
  path?: string | null;
}

export interface OpenClawNodeCheckResult {
  status: "ok" | "not_found" | "version_low" | string;
  version?: string | null;
  path?: string | null;
}

export interface OpenClawDependencyStatus {
  status: "ok" | "missing" | "version_low" | string;
  version?: string | null;
  path?: string | null;
  message: string;
  autoInstallSupported: boolean;
}

export interface OpenClawEnvironmentStatus {
  node: OpenClawDependencyStatus;
  git: OpenClawDependencyStatus;
  openclaw: OpenClawDependencyStatus;
  recommendedAction: string;
  summary: string;
  diagnostics?: OpenClawEnvironmentDiagnostics;
  tempArtifacts: string[];
}

export interface OpenClawEnvironmentDiagnostics {
  npmPath?: string | null;
  npmGlobalPrefix?: string | null;
  openclawPackagePath?: string | null;
  whereCandidates?: string[];
  supplementalSearchDirs?: string[];
  supplementalCommandCandidates?: string[];
}

export interface OpenClawActionResult {
  success: boolean;
  message: string;
}

export interface OpenClawCommandPreview {
  title: string;
  command: string;
}

export interface OpenClawGatewayStatusInfo {
  status: OpenClawGatewayStatus;
  port: number;
}

export interface OpenClawHealthInfo {
  status: "healthy" | "unhealthy" | string;
  gatewayPort: number;
  uptime?: number | null;
  version?: string | null;
}

export interface OpenClawUpdateInfo {
  hasUpdate: boolean;
  currentVersion?: string | null;
  latestVersion?: string | null;
  channel?: string | null;
  installKind?: string | null;
  packageManager?: string | null;
  message?: string | null;
}

export interface OpenClawChannelInfo {
  id: string;
  name: string;
  channelType: string;
  status: string;
}

export interface OpenClawInstallProgressEvent {
  message: string;
  level: "info" | "warn" | "error" | string;
}

export interface OpenClawSyncModelEntry {
  id: string;
  name: string;
  contextWindow?: number | null;
}

export interface OpenClawSyncConfigRequest {
  providerId: string;
  primaryModelId: string;
  models: OpenClawSyncModelEntry[];
}

export const OPENCLAW_INSTALL_PROGRESS_EVENT = "openclaw:install-progress";

export async function openclawCheckInstalled(): Promise<OpenClawBinaryInstallStatus> {
  return safeInvoke("openclaw_check_installed");
}

export async function openclawGetEnvironmentStatus(): Promise<OpenClawEnvironmentStatus> {
  return safeInvoke("openclaw_get_environment_status");
}

export async function openclawCheckNodeVersion(): Promise<OpenClawNodeCheckResult> {
  return safeInvoke("openclaw_check_node_version");
}

export async function openclawCheckGitAvailable(): Promise<OpenClawBinaryAvailabilityStatus> {
  return safeInvoke("openclaw_check_git_available");
}

export async function openclawGetNodeDownloadUrl(): Promise<string> {
  return safeInvoke("openclaw_get_node_download_url");
}

export async function openclawGetGitDownloadUrl(): Promise<string> {
  return safeInvoke("openclaw_get_git_download_url");
}

export async function openclawInstall(): Promise<OpenClawActionResult> {
  return safeInvoke("openclaw_install");
}

export async function openclawInstallDependency(
  kind: "node" | "git",
): Promise<OpenClawActionResult> {
  return safeInvoke("openclaw_install_dependency", { kind });
}

export async function openclawGetCommandPreview(
  operation: "install" | "uninstall" | "start" | "stop" | "restart",
  port?: number,
): Promise<OpenClawCommandPreview> {
  return safeInvoke("openclaw_get_command_preview", { operation, port });
}

export async function openclawUninstall(): Promise<OpenClawActionResult> {
  return safeInvoke("openclaw_uninstall");
}

export async function openclawCleanupTempArtifacts(): Promise<OpenClawActionResult> {
  return safeInvoke("openclaw_cleanup_temp_artifacts");
}

export async function openclawCheckUpdate(): Promise<OpenClawUpdateInfo> {
  return safeInvoke("openclaw_check_update");
}

export async function openclawPerformUpdate(): Promise<OpenClawActionResult> {
  return safeInvoke("openclaw_perform_update");
}

export async function openclawStartGateway(
  port?: number,
): Promise<OpenClawActionResult> {
  return safeInvoke("openclaw_start_gateway", { port });
}

export async function openclawStopGateway(): Promise<OpenClawActionResult> {
  return safeInvoke("openclaw_stop_gateway");
}

export async function openclawRestartGateway(): Promise<OpenClawActionResult> {
  return safeInvoke("openclaw_restart_gateway");
}

export async function openclawGetStatus(): Promise<OpenClawGatewayStatusInfo> {
  return safeInvoke("openclaw_get_status");
}

export async function openclawCheckHealth(): Promise<OpenClawHealthInfo> {
  return safeInvoke("openclaw_check_health");
}

export async function openclawGetDashboardUrl(): Promise<string> {
  return safeInvoke("openclaw_get_dashboard_url");
}

export async function openclawGetChannels(): Promise<OpenClawChannelInfo[]> {
  return safeInvoke("openclaw_get_channels");
}

export async function openclawSyncProviderConfig(
  request: OpenClawSyncConfigRequest,
): Promise<OpenClawActionResult> {
  return safeInvoke("openclaw_sync_provider_config", { request });
}

export async function listenOpenClawInstallProgress(
  handler: (payload: OpenClawInstallProgressEvent) => void,
): Promise<() => void> {
  return safeListen<OpenClawInstallProgressEvent>(
    OPENCLAW_INSTALL_PROGRESS_EVENT,
    (event) => handler(event.payload),
  );
}

export async function openclawGetProgressLogs(): Promise<
  OpenClawInstallProgressEvent[]
> {
  return safeInvoke("openclaw_get_progress_logs");
}

export const openclawApi = {
  checkInstalled: openclawCheckInstalled,
  getEnvironmentStatus: openclawGetEnvironmentStatus,
  checkNodeVersion: openclawCheckNodeVersion,
  checkGitAvailable: openclawCheckGitAvailable,
  getNodeDownloadUrl: openclawGetNodeDownloadUrl,
  getGitDownloadUrl: openclawGetGitDownloadUrl,
  install: openclawInstall,
  installDependency: openclawInstallDependency,
  getCommandPreview: openclawGetCommandPreview,
  uninstall: openclawUninstall,
  cleanupTempArtifacts: openclawCleanupTempArtifacts,
  checkUpdate: openclawCheckUpdate,
  performUpdate: openclawPerformUpdate,
  startGateway: openclawStartGateway,
  stopGateway: openclawStopGateway,
  restartGateway: openclawRestartGateway,
  getStatus: openclawGetStatus,
  checkHealth: openclawCheckHealth,
  getDashboardUrl: openclawGetDashboardUrl,
  getChannels: openclawGetChannels,
  getProgressLogs: openclawGetProgressLogs,
  syncProviderConfig: openclawSyncProviderConfig,
  listenInstallProgress: listenOpenClawInstallProgress,
};
