export type WorkspaceHarnessSessionMode = "default" | "general_workbench";

const LEGACY_GENERAL_WORKBENCH_SESSION_MODE_ALIAS = "theme_workbench";

export type HarnessSessionModeInput =
  | WorkspaceHarnessSessionMode
  | typeof LEGACY_GENERAL_WORKBENCH_SESSION_MODE_ALIAS;

export function normalizeHarnessSessionMode(
  value?: string | null,
): WorkspaceHarnessSessionMode | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (
    normalized === "general_workbench" ||
    normalized === LEGACY_GENERAL_WORKBENCH_SESSION_MODE_ALIAS
  ) {
    return "general_workbench";
  }

  if (normalized === "default") {
    return "default";
  }

  return null;
}

export function isGeneralWorkbenchSessionMode(value?: string | null): boolean {
  return normalizeHarnessSessionMode(value) === "general_workbench";
}
