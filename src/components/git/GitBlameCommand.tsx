import { useMemo } from "react";
import { useCommand } from "@/lib/commands/useCommand";
import type { CommandRegistration } from "@/lib/commands/registry";

export const GIT_BLAME_TOGGLE_EVENT = "lime:git-blame-toggle";

export interface GitBlameToggleDetail {
  rootPath: string;
  path: string;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/g, "");
}

/** App Server 只接受仓库内相对路径；绝对路径必须收敛到 rootPath 之下。 */
function toBlameRelativePath(
  rootPath: string,
  filePath: string,
): string | null {
  const root = normalizePath(rootPath.trim());
  const path = filePath.replace(/\\/g, "/");
  if (!root || !path) return null;
  const absolute =
    path.startsWith("/") ||
    path.startsWith("~/") ||
    /^[A-Za-z]:\//.test(path) ||
    path.startsWith("//");
  if (!absolute) return path;
  const rootWithSlash = `${root}/`;
  if (path.startsWith(rootWithSlash)) return path.slice(rootWithSlash.length);
  const caseInsensitive = /^[A-Za-z]:\//.test(root) || root.startsWith("//");
  if (
    caseInsensitive &&
    path.toLowerCase().startsWith(rootWithSlash.toLowerCase())
  ) {
    return path.slice(rootWithSlash.length);
  }
  return null;
}

/**
 * 只在右侧文件页签处于前台且确实打开了文件时注册命令，避免隐藏页签重复
 * 注册同一个命令 id，也保证没有活动文件时命令不存在。
 */
export function GitBlameCommand({
  rootPath,
  filePath,
  active = true,
}: {
  rootPath?: string | null;
  filePath?: string | null;
  active?: boolean;
}) {
  const normalizedRoot = rootPath?.trim() || null;
  const relativePath =
    normalizedRoot && filePath
      ? toBlameRelativePath(normalizedRoot, filePath)
      : null;
  const enabled = Boolean(active && normalizedRoot && relativePath);

  const command = useMemo<CommandRegistration>(
    () => ({
      id: "git.toggleBlame",
      titleKey: "commands.gitToggleBlame.title",
      descriptionKey: "commands.gitToggleBlame.description",
      section: "workspace",
      bindings: [],
      enabled,
      handler: () => {
        if (!enabled || !normalizedRoot || !relativePath) return;
        window.dispatchEvent(
          new CustomEvent<GitBlameToggleDetail>(GIT_BLAME_TOGGLE_EVENT, {
            detail: { rootPath: normalizedRoot, path: relativePath },
          }),
        );
      },
    }),
    [enabled, normalizedRoot, relativePath],
  );

  useCommand(command);
  return null;
}
