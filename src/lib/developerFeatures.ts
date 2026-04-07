import type { Config, DeveloperConfig } from "@/lib/api/appConfig";

const DEFAULT_DEVELOPER_CONFIG: DeveloperConfig = {
  workspace_harness_enabled: false,
};

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
