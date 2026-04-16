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
      title: "来源链",
      value: input.rulesSourceCount,
      unit: "源",
      available: input.rulesSourceCount > 0,
      description:
        input.rulesSourceCount > 0
          ? "当前已解析到可注入的规则与记忆来源文件。"
          : "当前还没有加载到有效来源链文件。",
    },
    {
      key: "working",
      title: "会话记忆",
      value: input.workingEntryCount,
      unit: "条",
      available: input.workingEntryCount > 0,
      description:
        input.workingEntryCount > 0
          ? "当前会话的 plan、摘录和工作文件正在沉淀。"
          : "当前还没有会话记忆条目。",
    },
    {
      key: "durable",
      title: "持久记忆",
      value: input.durableEntryCount,
      unit: "条",
      available: input.durableEntryCount > 0,
      description:
        input.durableEntryCount > 0
          ? "跨会话可复用的结构化沉淀已进入长期记忆视图。"
          : "当前还没有可复用的持久记忆。",
    },
    {
      key: "team",
      title: "团队记忆",
      value: input.teamSnapshotCount,
      unit: "份",
      available: input.teamSnapshotCount > 0,
      description:
        input.teamSnapshotCount > 0
          ? "repo 作用域的团队记忆快照可用于补足协作上下文。"
          : "当前仓库还没有团队记忆快照。",
    },
    {
      key: "compaction",
      title: "会话压缩",
      value: input.compactionCount,
      unit: "次",
      available: input.compactionCount > 0,
      description:
        input.compactionCount > 0
          ? "长会话压缩摘要可用于后续续接。"
          : "当前还没有可复用的会话压缩摘要。",
    },
  ];

  return {
    cards,
    readyLayers: cards.filter((card) => card.available).length,
    totalLayers: cards.length,
  };
}
