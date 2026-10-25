import type { AgentThreadItem } from "@/lib/api/agentProtocol";
import {
  isExcludedOutputPath,
  isOutputPathWithin,
  normalizeOutputPath,
  outputPathKey,
} from "./threadOutputPaths";

const localHosts = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "[::1]",
  "::1",
]);
// 对齐安装包 MP 的可视化文件资格，避免把内部 visualization HTML 当作网站。
const visualizationPath =
  /(?:^|[\\/])(?:\.lime|(?:\.lime-workspaces|OpenAI[\\/]Codex[\\/]workspaces)(?:[\\/]instances[\\/][0-9a-f-]+)?)[\\/]visualizations[\\/]\d{4}[\\/]\d{2}[\\/]\d{2}[\\/]([a-zA-Z0-9_-]+)[\\/][a-z0-9]+(?:-[a-z0-9]+)*\.html$/;

function uniqueLocalWebsite(text: string): string | null {
  const urls = new Set<string>();
  for (const match of text.matchAll(/\bhttps?:\/\/[^\s<>)"'`]+/gi)) {
    try {
      const url = new URL(match[0].replace(/[.,;!?]+$/u, ""));
      if (
        url.port &&
        !/[()[\]]/u.test(`${url.pathname}${url.search}${url.hash}`) &&
        (localHosts.has(url.hostname) || url.hostname.endsWith(".localhost"))
      )
        urls.add(url.href);
    } catch {
      /* 无效候选不能阻止同一正文的其他候选。 */
    }
  }
  return urls.size === 1 ? urls.values().next().value! : null;
}

export function readThreadOutputWebsite({
  items,
  finalMessage,
  cwd,
  projectlessOutputDirectory,
}: {
  items: readonly AgentThreadItem[];
  finalMessage?: AgentThreadItem;
  cwd: string | null;
  projectlessOutputDirectory: string | null;
}): { target: string; itemId: string } | null {
  if (finalMessage?.type === "agent_message") {
    const target = uniqueLocalWebsite(finalMessage.text);
    if (target) return { target, itemId: finalMessage.id };
  }
  const candidates = new Map<string, { target: string; itemId: string }>();
  for (const item of items) {
    if (item.type !== "patch" || item.file_status !== "completed") continue;
    for (const change of item.changes ?? []) {
      const target = normalizeOutputPath(
        change.kind.type === "update"
          ? (change.kind.move_path ?? change.path)
          : change.path,
      );
      if (
        !/\.html?$/i.test(target) ||
        visualizationPath.test(target) ||
        isExcludedOutputPath(target, cwd) ||
        (projectlessOutputDirectory !== null &&
          !isOutputPathWithin(target, projectlessOutputDirectory, cwd))
      )
        continue;
      const key = outputPathKey(target, cwd);
      if (!candidates.has(key))
        candidates.set(key, { target, itemId: item.id });
    }
  }
  return candidates.size === 1 ? candidates.values().next().value! : null;
}

export function websiteOutputName(target: string): string {
  try {
    const url = new URL(target);
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}${url.search}`;
  } catch {
    return normalizeOutputPath(target).split("/").at(-1) || target;
  }
}
