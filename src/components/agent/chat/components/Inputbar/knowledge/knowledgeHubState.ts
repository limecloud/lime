import type {
  InputbarKnowledgePackOption,
  InputbarKnowledgePackSelection,
} from "../types";

export type InputbarKnowledgeHubPrimaryAction =
  | "organize"
  | "manage"
  | "use"
  | "supplement"
  | "none";

export interface InputbarKnowledgeHubState {
  title: string;
  description: string;
  primaryAction: InputbarKnowledgeHubPrimaryAction;
  primaryLabel: string;
  readyCount: number;
  pendingCount: number;
}

export function normalizeKnowledgePackOptions({
  knowledgePackOptions,
  knowledgePackSelection,
}: {
  knowledgePackOptions: InputbarKnowledgePackOption[];
  knowledgePackSelection?: InputbarKnowledgePackSelection | null;
}) {
  const optionMap = new Map<string, InputbarKnowledgePackOption>();

  for (const option of knowledgePackOptions) {
    const packName = option.packName.trim();
    if (!packName || optionMap.has(packName)) {
      continue;
    }

    optionMap.set(packName, {
      ...option,
      packName,
    });
  }

  const selectedPackName = knowledgePackSelection?.packName.trim();
  if (selectedPackName && !optionMap.has(selectedPackName)) {
    optionMap.set(selectedPackName, {
      packName: selectedPackName,
      label: knowledgePackSelection?.label,
      status: knowledgePackSelection?.status,
    });
  }

  return Array.from(optionMap.values());
}

export function isReadyKnowledgePackStatus(status?: string | null): boolean {
  return status?.trim() === "ready";
}

export function resolveKnowledgeHubState({
  knowledgePackSelection,
  knowledgePackOptions,
  hasInputText,
  canManageKnowledgePacks,
  canStartKnowledgeOrganize,
}: {
  knowledgePackSelection?: InputbarKnowledgePackSelection | null;
  knowledgePackOptions: InputbarKnowledgePackOption[];
  hasInputText: boolean;
  canManageKnowledgePacks: boolean;
  canStartKnowledgeOrganize: boolean;
}): InputbarKnowledgeHubState {
  const readyCount = knowledgePackOptions.filter((option) =>
    isReadyKnowledgePackStatus(option.status),
  ).length;
  const pendingCount = knowledgePackOptions.length - readyCount;
  const currentLabel =
    knowledgePackSelection?.label ||
    knowledgePackSelection?.packName ||
    "项目资料";
  const selectedIsReady = isReadyKnowledgePackStatus(
    knowledgePackSelection?.status,
  );

  if (knowledgePackSelection && !selectedIsReady && canManageKnowledgePacks) {
    return {
      title: "资料待确认",
      description:
        `「${currentLabel}」还没有确认。先检查事实、适用场景和风险提示，确认后再用于生成。`,
      primaryAction: "manage",
      primaryLabel: "去确认资料",
      readyCount,
      pendingCount,
    };
  }

  if (knowledgePackSelection?.enabled) {
    return {
      title: `正在使用：${currentLabel}`,
      description:
        "本次生成会参考这份项目资料。需要补充新内容时，先把资料贴进输入框，再整理为项目资料。",
      primaryAction: canStartKnowledgeOrganize ? "supplement" : "none",
      primaryLabel: hasInputText ? "把当前输入补充为资料" : "补充资料",
      readyCount,
      pendingCount,
    };
  }

  if (knowledgePackSelection) {
    return {
      title: "选择项目资料",
      description:
        pendingCount > 0
          ? `当前可用：${currentLabel}。另有资料需要确认；待确认内容请先检查。`
          : `当前可用：${currentLabel}。使用后，本次生成会参考其中的事实、语气和边界。`,
      primaryAction: "use",
      primaryLabel: "使用这份资料",
      readyCount,
      pendingCount,
    };
  }

  if (pendingCount > 0 && canManageKnowledgePacks) {
    return {
      title: "有资料待确认",
      description:
        "先检查事实、适用场景和风险提示，确认后再用于生成，避免把未核对内容写进长期资料。",
      primaryAction: "manage",
      primaryLabel: "去确认资料",
      readyCount,
      pendingCount,
    };
  }

  return {
    title: "添加项目资料",
    description:
      "粘贴访谈稿、产品说明、SOP 或历史文案后，让当前 Agent 整理成可确认的项目资料；之后可在这里一键使用。",
    primaryAction: canStartKnowledgeOrganize ? "organize" : "none",
    primaryLabel: hasInputText ? "整理当前输入为资料" : "开始添加资料",
    readyCount,
    pendingCount,
  };
}
