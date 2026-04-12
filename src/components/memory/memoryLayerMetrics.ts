export interface LayerMetricsInput {
  rulesSourceCount: number;
  workingEntryCount: number;
  durableEntryCount: number;
  teamSnapshotCount: number;
  compactionCount: number;
}

export interface LayerCard {
  key: "rules" | "working" | "durable" | "team" | "compaction";
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

export function buildLayerMetrics(
  input: LayerMetricsInput,
): LayerMetricsResult {
  const cards: LayerCard[] = [
    {
      key: "rules",
      title: "规则层",
      value: input.rulesSourceCount,
      unit: "源",
      available: input.rulesSourceCount > 0,
      description:
        input.rulesSourceCount > 0
          ? "运行时已检测到可加载的规则与来源文件。"
          : "当前还没有加载到有效规则来源。",
    },
    {
      key: "working",
      title: "工作记忆",
      value: input.workingEntryCount,
      unit: "条",
      available: input.workingEntryCount > 0,
      description:
        input.workingEntryCount > 0
          ? "会话工作记忆文件已经开始沉淀。"
          : "当前还没有工作记忆条目。",
    },
    {
      key: "durable",
      title: "长期记忆",
      value: input.durableEntryCount,
      unit: "条",
      available: input.durableEntryCount > 0,
      description:
        input.durableEntryCount > 0
          ? "统一记忆库中已有可复用的结构化沉淀。"
          : "长期记忆库暂时为空。",
    },
    {
      key: "team",
      title: "Team 影子",
      value: input.teamSnapshotCount,
      unit: "份",
      available: input.teamSnapshotCount > 0,
      description:
        input.teamSnapshotCount > 0
          ? "本地已缓存 repo 作用域 Team 协作影子。"
          : "当前仓库还没有 Team shadow 快照。",
    },
    {
      key: "compaction",
      title: "压缩边界",
      value: input.compactionCount,
      unit: "次",
      available: input.compactionCount > 0,
      description:
        input.compactionCount > 0
          ? "最近已有上下文压缩摘要可供续接。"
          : "还没有可复用的上下文压缩摘要。",
    },
  ];

  return {
    cards,
    readyLayers: cards.filter((card) => card.available).length,
    totalLayers: cards.length,
  };
}
