import type { Config, DeveloperConfig } from "@/lib/api/appConfig";

const DEFAULT_DEVELOPER_CONFIG: DeveloperConfig = {
  workspace_harness_enabled: false,
};
const WORKSPACE_HARNESS_DEBUG_OVERRIDE_KEY =
  "lime:debug:workspace-harness-enabled:v1";

export function normalizeDeveloperConfig(
  config?: DeveloperConfig | null,
): DeveloperConfig {
  return {
    ...DEFAULT_DEVELOPER_CONFIG,
    ...(config ?? {}),
  };
}

export function isWorkspaceHarnessEnabled(
  config?: Pick<Config, "developer"> | null,
): boolean {
  return (
    normalizeDeveloperConfig(config?.developer).workspace_harness_enabled ===
    true
  );
}

export function readWorkspaceHarnessDebugOverride(): boolean | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage
      .getItem(WORKSPACE_HARNESS_DEBUG_OVERRIDE_KEY)
      ?.trim()
      .toLowerCase();

    if (!raw) {
      return null;
    }

    if (["1", "true", "enabled", "on"].includes(raw)) {
      return true;
    }

    if (["0", "false", "disabled", "off"].includes(raw)) {
      return false;
    }
  } catch {
    return null;
  }

  return null;
}

export function resolveWorkspaceHarnessEnabled(
  config?: Pick<Config, "developer"> | null,
): boolean {
  const debugOverride = readWorkspaceHarnessDebugOverride();
  if (debugOverride !== null) {
    return debugOverride;
  }

  return isWorkspaceHarnessEnabled(config);
}

export { WORKSPACE_HARNESS_DEBUG_OVERRIDE_KEY };
