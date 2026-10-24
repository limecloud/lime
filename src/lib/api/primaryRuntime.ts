import {
  METHOD_PRIMARY_RUNTIME_CANCEL_INSTALL,
  METHOD_PRIMARY_RUNTIME_DIAGNOSE_DEPENDENCIES,
  METHOD_PRIMARY_RUNTIME_RESET_DEPENDENCIES,
  METHOD_PRIMARY_RUNTIME_RUN_UPDATE_NOW,
  type CancelInstallResponse,
  type DiagnoseDependenciesResponse,
  type InstallDependenciesResponse,
  type PrimaryRuntimeInstallProgress,
} from "@limecloud/app-server-client";
import { AppServerClient } from "./appServer";
import { assertNotDiagnosticFacade } from "./diagnosticFacade";

export type { DiagnoseDependenciesResponse, PrimaryRuntimeInstallProgress };

const phases = new Set([
  "downloading",
  "verifying",
  "extracting",
  "validating",
  "configuring",
  "ready",
  "canceled",
  "error",
]);

function validateProgress(update: PrimaryRuntimeInstallProgress) {
  if (
    !update ||
    typeof update.id !== "string" ||
    !update.id ||
    !phases.has(update.phase) ||
    !Number.isSafeInteger(update.downloadedBytes) ||
    update.downloadedBytes < 0 ||
    (update.totalBytes != null &&
      (!Number.isSafeInteger(update.totalBytes) ||
        update.totalBytes < update.downloadedBytes))
  )
    throw new Error("Invalid primary runtime installation progress");
  return update;
}

async function request<T>(method: string, params: object): Promise<T> {
  const response = await new AppServerClient().request<T>(method, params);
  assertNotDiagnosticFacade(method, response.result, "App Server");
  return response.result;
}

export const primaryRuntime = {
  async diagnoseDependencies({
    probeExecutables = false,
  } = {}): Promise<DiagnoseDependenciesResponse> {
    const result = await request<DiagnoseDependenciesResponse>(
      METHOD_PRIMARY_RUNTIME_DIAGNOSE_DEPENDENCIES,
      { probeExecutables },
    );
    if (
      !result ||
      typeof result.supported !== "boolean" ||
      typeof result.enabled !== "boolean" ||
      typeof result.installed !== "boolean" ||
      typeof result.expectedVersion !== "string" ||
      (result.bundleVersion !== null &&
        typeof result.bundleVersion !== "string") ||
      !Array.isArray(result.problems) ||
      result.problems.some((problem) => typeof problem !== "string")
    )
      throw new Error("Invalid primary runtime diagnostics");
    if (result.update != null) validateProgress(result.update);
    return result;
  },
  async runUpdateNow() {
    const result = await request<InstallDependenciesResponse>(
      METHOD_PRIMARY_RUNTIME_RUN_UPDATE_NOW,
      {},
    );
    return validateProgress(result?.update);
  },
  async resetDependencies() {
    const result = await request<InstallDependenciesResponse>(
      METHOD_PRIMARY_RUNTIME_RESET_DEPENDENCIES,
      {},
    );
    return validateProgress(result?.update);
  },
  async cancelInstall({ id }: { id: string }) {
    const result = await request<CancelInstallResponse>(
      METHOD_PRIMARY_RUNTIME_CANCEL_INSTALL,
      { id },
    );
    if (!result || typeof result.canceled !== "boolean")
      throw new Error("Invalid primary runtime cancellation");
    return result.canceled;
  },
};

export function isInstallActive(
  update: PrimaryRuntimeInstallProgress | null | undefined,
) {
  return Boolean(
    update && !["ready", "canceled", "error"].includes(update.phase),
  );
}
