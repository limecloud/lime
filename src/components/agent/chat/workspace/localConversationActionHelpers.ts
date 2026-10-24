import type {
  LocalEnvironmentAction,
  LocalEnvironmentPlatform,
} from "../../../../../packages/app-server-client/src/protocol";

export interface TerminalAction {
  command: string;
  cwd: string;
  title: string;
}

export function environmentActionPlatform(
  userAgent: string,
): LocalEnvironmentPlatform | null {
  if (/Windows/i.test(userAgent)) return "win32";
  if (/Macintosh|Mac OS X/i.test(userAgent)) return "darwin";
  if (/Linux/i.test(userAgent)) return "linux";
  return null;
}

export function availableEnvironmentActions(
  actions: readonly LocalEnvironmentAction[],
  platform: LocalEnvironmentPlatform | null,
) {
  return actions.filter(
    (action) => !action.platform || !platform || action.platform === platform,
  );
}

/** 与安装包 xS 相同：配置相对路径基于当前 Git root，不能基于源配置的绝对路径。 */
export function environmentActionCwd({
  relativePath,
  repoRoot,
  workspaceRoot,
}: {
  relativePath?: string | null;
  repoRoot?: string | null;
  workspaceRoot: string;
}): string {
  if (!repoRoot || !relativePath) return workspaceRoot || repoRoot || "";
  const separator = repoRoot.includes("\\") ? "\\" : "/";
  const root = repoRoot.replace(/[\\/]+$/, "");
  const parts = relativePath
    .split(/[\\/]+/)
    .filter((part) => part && part !== ".");
  return parts.length
    ? `${root}${separator}${parts.join(separator)}`
    : repoRoot;
}
