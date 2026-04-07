import type { ProjectMemory } from "@/lib/api/memory";

export interface LayerMetricsInput {
  unifiedTotalEntries: number;
  contextTotalEntries: number;
  projectId: string | null;
  projectMemory: ProjectMemory | null;
}

export interface LayerCard {
  key: "unified" | "context" | "project";
  title: string;
  value: number;
  unit: string;
  available: boolean;
  description: string;
}

export interface LayerMetricsResult {
  cards: LayerCard[];
  readyLayers: number;
  totalLayers: number;
}

function hasWorldBuilding(memory: ProjectMemory | null): boolean {
  return !!memory?.world_building?.description?.trim();
}

function projectCoverageCount(memory: ProjectMemory | null): number {
  if (!memory) {
    return 0;
  }

  let covered = 0;
  if (memory.characters.length > 0) covered += 1;
  if (hasWorldBuilding(memory)) covered += 1;
  if (memory.outline.length > 0) covered += 1;
  return covered;
}

export function buildLayerMetrics(
  input: LayerMetricsInput,
): LayerMetricsResult {
  const projectCoverage = projectCoverageCount(input.projectMemory);
  const hasProjectSelection = !!input.projectId;

  const cards: LayerCard[] = [
    {
      key: "unified",
      title: "第一层：统一记忆",
      value: input.unifiedTotalEntries,
      unit: "条",
      available: input.unifiedTotalEntries > 0,
      description:
        input.unifiedTotalEntries > 0
          ? "从历史对话沉淀出的结构化记忆。"
          : "暂无沉淀结果，可点击“请求记忆分析”。",
    },
    {
      key: "context",
      title: "第二层：上下文记忆",
      value: input.contextTotalEntries,
      unit: "条",
      available: input.contextTotalEntries > 0,
      description:
        input.contextTotalEntries > 0
          ? "工作流文件记忆（计划/发现/进度）已生效。"
          : "当前会话尚未形成文件记忆。",
    },
    {
      key: "project",
      title: "第三层：项目记忆",
      value: projectCoverage,
      unit: "/3 维",
      available: projectCoverage > 0,
      description: !hasProjectSelection
        ? "未选择项目，无法加载角色/世界观/大纲。"
        : projectCoverage > 0
          ? "项目级长期记忆已参与。"
          : "项目已选择，但还未填写项目记忆内容。",
    },
  ];

  return {
    readyLayers: cards.filter((card) => card.available).length,
    totalLayers: cards.length,
    cards,
  };
}
