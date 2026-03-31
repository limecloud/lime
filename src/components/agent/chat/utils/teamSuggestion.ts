import { getTeamPresetOption } from "./teamPresets";

export type SuggestedTeamRole =
  | "explorer"
  | "executor"
  | "verifier"
  | "researcher"
  | "planner"
  | "reviewer"
  | "writer";

export interface TeamSuggestionContext {
  input: string;
  activeTheme?: string;
  subagentEnabled?: boolean;
}

export interface TeamSuggestionResult {
  score: number;
  shouldSuggest: boolean;
  reasons: string[];
  suggestedRoles: SuggestedTeamRole[];
  suggestedPresetId?: string;
  suggestedPresetLabel?: string;
}

export const TEAM_SUGGESTION_THRESHOLD = 0.45;

export const TEAM_ROLE_LABELS: Record<SuggestedTeamRole, string> = {
  explorer: "分析",
  executor: "执行",
  verifier: "验证",
  researcher: "调研",
  planner: "规划",
  reviewer: "复核",
  writer: "写作",
};

const EXPLICIT_TEAM_PATTERNS = [
  /team runtime/i,
  /\bteam\b/i,
  /多代理/,
  /子代理/,
  /父子线程/,
  /subagent/i,
  /spawn_agent/i,
  /wait_agent/i,
  /resume_agent/i,
  /close_agent/i,
  /explorer/i,
  /executor/i,
  /orchestrator/i,
];

const PARALLEL_PATTERNS = [
  /并行/,
  /同时/,
  /分别/,
  /拆成/,
  /拆分/,
  /多个子任务/,
  /多角色/,
  /协作/,
  /两路/,
  /双线程/,
];

const VERIFY_PATTERNS = [
  /验证/,
  /复核/,
  /对比/,
  /回归/,
  /测试/,
  /review/i,
  /验收/,
  /汇总/,
  /总结/,
  /收敛/,
];

const COMPLEXITY_PATTERNS = [
  /联调/,
  /端到端/,
  /跨模块/,
  /架构/,
  /重构/,
  /迁移/,
  /排查/,
  /落地/,
  /工作流/,
  /roadmap/i,
  /runtime/i,
  /仓库/,
  /repo/i,
  /前端/,
  /后端/,
  /rust/i,
  /tauri/i,
  /react/i,
  /gui/i,
  /ui/i,
];

const SIMPLE_TASK_PATTERNS = [
  /翻译/,
  /润色/,
  /改写/,
  /一句话/,
  /起个标题/,
  /生成标题/,
  /写一封邮件/,
  /总结一下/,
  /简单介绍/,
];

const MULTI_STAGE_KEYWORDS = [
  "分析",
  "设计",
  "实现",
  "修复",
  "验证",
  "测试",
  "回归",
  "汇总",
  "总结",
  "对比",
  "排查",
  "联调",
  "重构",
  "规划",
  "拆分",
];

function clampScore(value: number) {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function matchAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function countMatchedPatterns(text: string, patterns: RegExp[]) {
  return patterns.reduce(
    (count, pattern) => count + (pattern.test(text) ? 1 : 0),
    0,
  );
}

function countMultiStageKeywords(text: string) {
  return MULTI_STAGE_KEYWORDS.reduce(
    (count, keyword) => count + (text.includes(keyword) ? 1 : 0),
    0,
  );
}

function inferSuggestedRoles(
  normalizedInput: string,
  activeTheme?: string,
): SuggestedTeamRole[] {
  if (
    /team runtime|team|多代理|子代理|父子线程|subagent|explorer|executor|orchestrator/i.test(
      normalizedInput,
    )
  ) {
    return ["explorer", "executor", "verifier"];
  }

  if (
    /bug|报错|修复|代码|工程|仓库|repo|前端|后端|rust|react|tauri|测试|联调|重构/i.test(
      normalizedInput,
    )
  ) {
    return ["explorer", "executor", "verifier"];
  }

  if (
    activeTheme === "knowledge" ||
    /研究|调研|资料|对比|结论|趋势|分析/i.test(normalizedInput)
  ) {
    return ["researcher", "planner", "reviewer"];
  }

  if (
    activeTheme === "document" ||
    /文档|邮件|方案|汇报|提纲|草稿|写作/i.test(normalizedInput)
  ) {
    return ["planner", "writer", "reviewer"];
  }

  return ["planner", "executor", "reviewer"];
}

function inferSuggestedPresetId(
  normalizedInput: string,
  activeTheme?: string,
): string {
  if (
    /bug|报错|修复|代码|工程|仓库|repo|前端|后端|rust|react|tauri|测试|联调|重构/i.test(
      normalizedInput,
    )
  ) {
    return "code-triage-team";
  }

  if (
    activeTheme === "knowledge" ||
    activeTheme === "planning" ||
    activeTheme === "document" ||
    /研究|调研|资料|对比|结论|趋势|分析|文档|方案/i.test(normalizedInput)
  ) {
    return "research-team";
  }

  if (/内容|创意|文案|脚本|选题|发布|海报|视频/i.test(normalizedInput)) {
    return "content-creation-team";
  }

  return "code-triage-team";
}

export function getTeamSuggestion({
  input,
  activeTheme,
  subagentEnabled = false,
}: TeamSuggestionContext): TeamSuggestionResult {
  const trimmedInput = input.trim();
  if (!trimmedInput || subagentEnabled) {
    return {
      score: 0,
      shouldSuggest: false,
      reasons: [],
      suggestedRoles: [],
      suggestedPresetId: undefined,
      suggestedPresetLabel: undefined,
    };
  }

  const normalizedInput = trimmedInput.toLowerCase();
  const reasons: string[] = [];
  let score = 0;

  const explicitTeamIntent = matchAny(normalizedInput, EXPLICIT_TEAM_PATTERNS);
  if (explicitTeamIntent) {
    score += 0.52;
    reasons.push("你已经显式提到 Team、多代理或父子线程，这类任务应走协作运行时。");
  }

  const parallelSignals = countMatchedPatterns(normalizedInput, PARALLEL_PATTERNS);
  if (parallelSignals > 0) {
    score += parallelSignals > 1 ? 0.22 : 0.16;
    reasons.push("描述里出现并行拆分或多角色分工信号，适合让主线程编排多个子代理。");
  }

  const multiStageCount = countMultiStageKeywords(trimmedInput);
  if (multiStageCount >= 3) {
    score += 0.22;
    reasons.push("任务同时包含分析、执行、验证等多个阶段，拆成团队协作更容易收敛。");
  } else if (multiStageCount === 2) {
    score += 0.12;
  }

  const verificationSignals = countMatchedPatterns(normalizedInput, VERIFY_PATTERNS);
  if (verificationSignals > 0) {
    score += 0.12;
    reasons.push("你还要求验证、回归或汇总，说明主线程需要负责最终收口。");
  }

  const complexitySignals = countMatchedPatterns(normalizedInput, COMPLEXITY_PATTERNS);
  if (complexitySignals > 0) {
    score += complexitySignals > 1 ? 0.16 : 0.1;
    reasons.push("需求涉及跨模块实现或联调，单线程连续处理的等待成本更高。");
  }

  if (trimmedInput.length >= 80) {
    score += 0.08;
  }
  if (trimmedInput.length >= 160) {
    score += 0.08;
  }

  if (
    ["general", "knowledge", "planning", "document"].includes(
      activeTheme?.trim().toLowerCase() ?? "",
    ) &&
    score > 0
  ) {
    score += 0.04;
  }

  if (
    ["social-media", "video"].includes(
      activeTheme?.trim().toLowerCase() ?? "",
    ) &&
    !explicitTeamIntent
  ) {
    score -= 0.08;
  }

  if (
    trimmedInput.length < 32 &&
    multiStageCount < 2 &&
    parallelSignals === 0 &&
    !explicitTeamIntent &&
    matchAny(trimmedInput, SIMPLE_TASK_PATTERNS)
  ) {
    score -= 0.22;
  }

  const normalizedScore = clampScore(score);
  const suggestedPresetId = inferSuggestedPresetId(normalizedInput, activeTheme);
  return {
    score: normalizedScore,
    shouldSuggest: normalizedScore >= TEAM_SUGGESTION_THRESHOLD,
    reasons: reasons.slice(0, 3),
    suggestedRoles: inferSuggestedRoles(normalizedInput, activeTheme),
    suggestedPresetId,
    suggestedPresetLabel: getTeamPresetOption(suggestedPresetId)?.label,
  };
}
