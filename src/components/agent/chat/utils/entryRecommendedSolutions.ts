export interface EntryRecommendedSolutionItem {
  id: string;
  title: string;
  summary: string;
  outputHint: string;
  categoryLabel: string;
  prompt: string;
  badge: string;
  actionLabel: string;
  statusLabel: string;
  statusTone: "emerald";
  recentUsedAt: number | null;
  isRecent: boolean;
  themeTarget?: string;
  shouldEnableWebSearch?: boolean;
  shouldEnableTeamMode?: boolean;
  shouldLaunchBrowserAssist?: boolean;
}

interface EntryRecommendedSolutionUsageRecord {
  solutionId: string;
  usedAt: number;
}

interface EntryRecommendedSolutionDefinition {
  id: string;
  title: string;
  summary: string;
  outputHint: string;
  categoryLabel: string;
  prompt: string;
  themeTarget?: string;
  shouldEnableWebSearch?: boolean;
  shouldEnableTeamMode?: boolean;
  shouldLaunchBrowserAssist?: boolean;
}

const ENTRY_RECOMMENDED_SOLUTION_USAGE_STORAGE_KEY =
  "lime:entry-recommended-solution-usage:v1";
const MAX_ENTRY_RECOMMENDED_SOLUTION_USAGE_RECORDS = 12;

const ENTRY_RECOMMENDED_SOLUTIONS: EntryRecommendedSolutionDefinition[] = [
  {
    id: "web-research-brief",
    title: "网页研究简报",
    summary:
      "快速整理调研范围、关键信息与结论框架，适合先把研究任务落成一版结构化简报。",
    outputHint: "研究提纲 + 结论简报",
    categoryLabel: "研究与采集",
    prompt:
      "请围绕这个主题先给我做一版网页研究简报：明确研究目标、关键信息来源、核心发现、风险点，以及接下来最值得继续追踪的问题。",
    shouldEnableWebSearch: true,
  },
  {
    id: "social-post-starter",
    title: "内容主稿生成",
    summary:
      "围绕目标受众、表达结构和关键信息，先生成一版可继续迭代的内容首稿。",
    outputHint: "内容首稿 + 结构提纲",
    categoryLabel: "写作与方案",
    prompt:
      "请先帮我起草一版内容首稿：明确目标受众、标题方向、正文结构和可继续扩写的角度。",
  },
  {
    id: "frontend-concept",
    title: "前端概念方案",
    summary:
      "快速产出信息架构、关键模块与页面关系，适合产品概念、后台台架或工作台原型讨论。",
    outputHint: "IA + 模块方案",
    categoryLabel: "写作与方案",
    prompt:
      "请帮我先整理一版前端概念方案：输出信息架构、核心页面、关键模块、交互流程和第一轮组件拆分建议。",
  },
  {
    id: "slide-outline",
    title: "演示提纲草案",
    summary:
      "先拿到一版可讲述的演示结构，覆盖封面、问题、观点、案例与行动建议。",
    outputHint: "PPT 大纲 + 讲述线",
    categoryLabel: "写作与方案",
    prompt:
      "请基于这个目标先生成一版演示提纲：包含封面定位、目录、核心论点、案例支撑、结论和下一步行动。",
  },
  {
    id: "browser-assist-task",
    title: "网页登录与采集",
    summary:
      "适合登录、表单、网页操作和信息采集，起始动作会先写进当前对话，再按需准备浏览器连接。",
    outputHint: "浏览器任务起步",
    categoryLabel: "研究与采集",
    prompt:
      "请协助我完成一个浏览器任务：先明确目标网页、目标动作、约束条件和预期结果，并在当前对话里继续执行。",
    shouldLaunchBrowserAssist: true,
  },
  {
    id: "team-breakdown",
    title: "任务拆分",
    summary:
      "适合需要并行调研、方案拆解或多角色分工的任务，进入后默认启用任务拆分偏好。",
    outputHint: "任务拆解 + 分工执行",
    categoryLabel: "多步骤执行",
    prompt:
      "请把这个任务按任务拆分方式拆解：先定义目标和约束，再拆成并行子任务，明确每项子任务的职责、产出和回收方式。",
    shouldEnableTeamMode: true,
  },
];

function isValidUsageRecord(
  value: unknown,
): value is EntryRecommendedSolutionUsageRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<EntryRecommendedSolutionUsageRecord>;
  return (
    typeof record.solutionId === "string" &&
    record.solutionId.length > 0 &&
    typeof record.usedAt === "number" &&
    Number.isFinite(record.usedAt)
  );
}

function listEntryRecommendedSolutionUsage(): EntryRecommendedSolutionUsageRecord[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(
      ENTRY_RECOMMENDED_SOLUTION_USAGE_STORAGE_KEY,
    );
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(isValidUsageRecord)
      .sort((left, right) => right.usedAt - left.usedAt)
      .slice(0, MAX_ENTRY_RECOMMENDED_SOLUTION_USAGE_RECORDS);
  } catch {
    return [];
  }
}

function getEntryRecommendedSolutionUsageMap(): Map<
  string,
  EntryRecommendedSolutionUsageRecord
> {
  return new Map(
    listEntryRecommendedSolutionUsage().map((record) => [
      record.solutionId,
      record,
    ]),
  );
}

function resolveEntryRecommendedSolutionBadge(
  solution: EntryRecommendedSolutionDefinition,
  isRecent: boolean,
): string {
  if (isRecent) {
    return "最近使用";
  }
  return solution.categoryLabel;
}

export function listEntryRecommendedSolutions(): EntryRecommendedSolutionItem[] {
  const usageMap = getEntryRecommendedSolutionUsageMap();

  return ENTRY_RECOMMENDED_SOLUTIONS.map((solution, index) => {
    const recentRecord = usageMap.get(solution.id);
    const recentUsedAt = recentRecord?.usedAt ?? null;

    return {
      ...solution,
      badge: resolveEntryRecommendedSolutionBadge(
        solution,
        typeof recentUsedAt === "number",
      ),
      actionLabel: "立即开始",
      statusLabel: "可直接开始",
      statusTone: "emerald" as const,
      recentUsedAt,
      isRecent: typeof recentUsedAt === "number",
      _sortIndex: index,
    };
  })
    .sort((left, right) => {
      if (left.recentUsedAt && right.recentUsedAt) {
        if (left.recentUsedAt !== right.recentUsedAt) {
          return right.recentUsedAt - left.recentUsedAt;
        }
      } else if (left.recentUsedAt) {
        return -1;
      } else if (right.recentUsedAt) {
        return 1;
      }

      return left._sortIndex - right._sortIndex;
    })
    .map(({ _sortIndex, ...solution }) => solution);
}

export function recordEntryRecommendedSolutionUsage(solutionId: string): void {
  const nextRecord: EntryRecommendedSolutionUsageRecord = {
    solutionId,
    usedAt: Date.now(),
  };

  const nextRecords = [
    nextRecord,
    ...listEntryRecommendedSolutionUsage().filter(
      (record) => record.solutionId !== solutionId,
    ),
  ].slice(0, MAX_ENTRY_RECOMMENDED_SOLUTION_USAGE_RECORDS);

  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      ENTRY_RECOMMENDED_SOLUTION_USAGE_STORAGE_KEY,
      JSON.stringify(nextRecords),
    );
  } catch {
    // ignore write errors
  }
}
