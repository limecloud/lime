import {
  getSupportedCodexSlashCommands,
  getUnsupportedCodexSlashCommands,
} from "./parser";
import type {
  CodexSlashStatusSnapshot,
  ParsedCodexSlashCommand,
} from "./types";

function formatExecutionStrategyLabel(
  strategy: CodexSlashStatusSnapshot["executionStrategy"],
): string {
  switch (strategy) {
    case "code_orchestrated":
      return "代码编排";
    case "auto":
      return "自动路由";
    case "react":
    default:
      return "对话执行";
  }
}

export function buildCodexSlashHelpMessage(): string {
  const supported = getSupportedCodexSlashCommands().map((command) => {
    const suffix = command.argumentHint ? ` ${command.argumentHint}` : "";
    return `- ${command.commandPrefix}${suffix}：${command.description}`;
  });
  const unsupported = getUnsupportedCodexSlashCommands()
    .map((command) => command.commandPrefix)
    .join("、");

  return [
    "可用 Lime 命令：",
    ...supported,
    "",
    `暂未支持：${unsupported}`,
  ].join("\n");
}

export function buildCodexSlashStatusMessage(
  snapshot: CodexSlashStatusSnapshot,
): string {
  const providerLabel = snapshot.providerType.trim() || "未设置";
  const modelLabel = snapshot.model.trim() || "未设置";

  return [
    "当前会话状态：",
    `- 会话：${snapshot.sessionId || "未创建"}`,
    `- 当前 Turn：${snapshot.currentTurnId || "无"}`,
    `- 模型：${providerLabel} / ${modelLabel}`,
    `- 执行策略：${formatExecutionStrategyLabel(snapshot.executionStrategy)}`,
    `- 运行中：${snapshot.isSending ? "是" : "否"}`,
    `- 排队消息：${snapshot.queuedTurnsCount}`,
  ].join("\n");
}

export function buildCodexSlashModelMessage(
  snapshot: CodexSlashStatusSnapshot,
): string {
  const providerLabel = snapshot.providerType.trim() || "未设置";
  const modelLabel = snapshot.model.trim() || "未设置";

  return [
    "当前模型配置：",
    `- Provider：${providerLabel}`,
    `- 模型：${modelLabel}`,
    "",
    "切换模型请使用输入框右侧的模型选择器。",
  ].join("\n");
}

export function buildCodexSlashPrompt(
  command: ParsedCodexSlashCommand,
): string | null {
  const userInput = command.userInput.trim();

  switch (command.definition.key) {
    case "review":
      return userInput
        ? `请对以下对象进行代码审查，优先关注 bug、风险、行为回归与缺失测试；先列 findings，再给简短结论。\n\n${userInput}`
        : "请对当前工作区未提交的改动做代码审查，优先关注 bug、风险、行为回归与缺失测试；先列 findings，再给简短结论。";
    case "diff":
      return userInput
        ? `请查看并解释以下 diff 或变更范围，概括关键修改、潜在风险与建议验证项：\n\n${userInput}`
        : "请查看当前工作区的 diff，概括关键修改、潜在风险与建议验证项。";
    case "init":
      return userInput
        ? `请初始化或更新仓库根目录的 AGENTS.md，内容聚焦仓库约定、构建/测试命令、模块边界与开发守则，并结合以下额外要求：\n\n${userInput}`
        : "请初始化或更新仓库根目录的 AGENTS.md，内容聚焦仓库约定、构建/测试命令、模块边界与开发守则。";
    default:
      return null;
  }
}

export function buildUnsupportedCodexSlashCommandMessage(
  command: ParsedCodexSlashCommand,
): string {
  return `命令 ${command.definition.commandPrefix} 已识别，但当前 Lime 暂未支持。可先使用 /help 查看已接入命令。`;
}
