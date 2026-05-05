import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { AutoContinueRequestPayload } from "@/lib/api/agentRuntime";
import {
  listKnowledgePacks,
  type KnowledgePackSummary,
} from "@/lib/api/knowledge";
import {
  importKnowledgePathSource,
  importKnowledgeTextSource,
} from "@/features/knowledge/import/knowledgeSourceImport";
import { getKnowledgeUnsupportedSourceMessage } from "@/features/knowledge/import/knowledgeSourceSupport";
import {
  buildKnowledgeOrganizePrompt,
  normalizeKnowledgeDraftName,
} from "@/features/knowledge/agent/knowledgePromptBuilder";
import { buildKnowledgeBuilderMetadata } from "@/features/knowledge/agent/knowledgeMetadata";
import type { AgentInitialKnowledgePackSelectionParams } from "@/types/page";
import type {
  InputbarKnowledgePackOption,
  InputbarKnowledgePackSelection,
} from "../../components/Inputbar/types";
import type { HandleSendOptions } from "../../hooks/handleSendTypes";
import type { MessageImage, MessagePathReference } from "../../types";

type KnowledgeExecutionStrategy = "react" | "code_orchestrated" | "auto";

type WorkspaceKnowledgeHandleSend = (
  images?: MessageImage[],
  webSearch?: boolean,
  thinking?: boolean,
  textOverride?: string,
  executionStrategy?: KnowledgeExecutionStrategy,
  autoContinuePayload?: AutoContinueRequestPayload,
  sendOptions?: HandleSendOptions,
) => void | Promise<boolean> | boolean;

function isReadyKnowledgePack(pack: KnowledgePackSummary): boolean {
  return pack.metadata.status === "ready";
}

export function chooseDefaultKnowledgePack(
  packs: KnowledgePackSummary[],
): KnowledgePackSummary | null {
  return (
    packs.find((pack) => pack.defaultForWorkspace && isReadyKnowledgePack(pack)) ??
    packs.find(isReadyKnowledgePack) ??
    packs.find((pack) => pack.defaultForWorkspace) ??
    packs[0] ??
    null
  );
}

interface UseWorkspaceKnowledgeRuntimeParams {
  projectRootPath?: string | null;
  currentSessionTitle?: string | null;
  input: string;
  setInput: (value: string) => void;
  executionStrategy?: KnowledgeExecutionStrategy;
  handleSend: WorkspaceKnowledgeHandleSend;
  onOpenKnowledgeManagement?: (workingDir?: string | null) => void;
  initialKnowledgePackSelection?: AgentInitialKnowledgePackSelectionParams | null;
}

interface UseWorkspaceKnowledgeRuntimeResult {
  knowledgePackSelection: InputbarKnowledgePackSelection | null;
  knowledgePackOptions: InputbarKnowledgePackOption[];
  onToggleKnowledgePack: (enabled: boolean) => void;
  onSelectKnowledgePack: (packName: string) => void;
  onStartKnowledgeOrganize: () => void;
  onManageKnowledgePacks?: () => void;
  onImportPathReferenceAsKnowledge: (reference: MessagePathReference) => void;
  onImportTextAsKnowledge: (source: {
    sourceName: string;
    sourceText: string;
    description?: string | null;
    packType?: string | null;
  }) => void;
}

export function useWorkspaceKnowledgeRuntime({
  projectRootPath,
  currentSessionTitle,
  input,
  setInput,
  executionStrategy,
  handleSend,
  onOpenKnowledgeManagement,
  initialKnowledgePackSelection,
}: UseWorkspaceKnowledgeRuntimeParams): UseWorkspaceKnowledgeRuntimeResult {
  const [knowledgePacks, setKnowledgePacks] = useState<KnowledgePackSummary[]>(
    [],
  );
  const [selectedKnowledgePackName, setSelectedKnowledgePackName] = useState<
    string | null
  >(null);
  const [knowledgePackEnabled, setKnowledgePackEnabled] = useState(false);
  const initialSelectionPackName =
    initialKnowledgePackSelection?.packName.trim() ?? "";
  const initialSelectionWorkingDir =
    initialKnowledgePackSelection?.workingDir.trim() ?? "";
  const effectiveProjectRootPath =
    projectRootPath?.trim() || initialSelectionWorkingDir;
  const initialSelectionMatchesWorkingDir = Boolean(
    initialSelectionWorkingDir &&
      initialSelectionWorkingDir === effectiveProjectRootPath,
  );
  const shouldEnableInitialSelection = Boolean(
    initialKnowledgePackSelection?.enabled &&
      initialSelectionPackName &&
      initialSelectionMatchesWorkingDir,
  );

  const refreshKnowledgePacks = useCallback(
    async (workingDir: string, preferredPackName?: string | null) => {
      const response = await listKnowledgePacks({
        workingDir,
        includeArchived: false,
      });
      const nextDefaultPack = chooseDefaultKnowledgePack(response.packs);

      setKnowledgePacks(response.packs);
      setSelectedKnowledgePackName((current) => {
        const normalizedPreferred = preferredPackName?.trim();
        if (
          normalizedPreferred &&
          response.packs.some(
            (pack) => pack.metadata.name === normalizedPreferred,
          )
        ) {
          return normalizedPreferred;
        }

        if (
          current &&
          response.packs.some((pack) => pack.metadata.name === current)
        ) {
          return current;
        }

        return nextDefaultPack?.metadata.name ?? null;
      });
      return response.packs;
    },
    [],
  );

  useEffect(() => {
    const workingDir = effectiveProjectRootPath;
    if (!workingDir) {
      setKnowledgePacks([]);
      setSelectedKnowledgePackName(null);
      setKnowledgePackEnabled(false);
      return;
    }

    let cancelled = false;
    refreshKnowledgePacks(workingDir, initialSelectionPackName || null)
      .then((responsePacks) => {
        if (cancelled) {
          return;
        }
        void responsePacks;
        setKnowledgePackEnabled(shouldEnableInitialSelection);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        console.warn("[AgentChatPage] 读取项目资料失败:", error);
        setKnowledgePacks([]);
        setSelectedKnowledgePackName(null);
        setKnowledgePackEnabled(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    effectiveProjectRootPath,
    initialSelectionPackName,
    refreshKnowledgePacks,
    shouldEnableInitialSelection,
  ]);

  const selectedKnowledgePack = useMemo(() => {
    if (knowledgePacks.length === 0) {
      return null;
    }

    return (
      knowledgePacks.find(
        (pack) => pack.metadata.name === selectedKnowledgePackName,
      ) ??
      chooseDefaultKnowledgePack(knowledgePacks)
    );
  }, [knowledgePacks, selectedKnowledgePackName]);

  const knowledgePackOptions = useMemo(() => {
    const options: InputbarKnowledgePackOption[] = knowledgePacks.map(
      (pack) => ({
        packName: pack.metadata.name,
        label: pack.metadata.description || pack.metadata.name,
        status: pack.metadata.status,
        defaultForWorkspace: pack.defaultForWorkspace,
      }),
    );

    if (
      initialSelectionMatchesWorkingDir &&
      initialSelectionPackName &&
      !options.some((option) => option.packName === initialSelectionPackName)
    ) {
      options.push({
        packName: initialSelectionPackName,
        label: initialKnowledgePackSelection?.label || initialSelectionPackName,
        status: initialKnowledgePackSelection?.status,
        defaultForWorkspace: false,
      });
    }

    return options;
  }, [
    initialKnowledgePackSelection,
    initialSelectionMatchesWorkingDir,
    initialSelectionPackName,
    knowledgePacks,
  ]);

  const knowledgePackSelection = useMemo(() => {
    if (selectedKnowledgePack && effectiveProjectRootPath) {
      return {
        enabled: knowledgePackEnabled,
        packName: selectedKnowledgePack.metadata.name,
        workingDir: effectiveProjectRootPath,
        label:
          selectedKnowledgePack.metadata.description ||
          selectedKnowledgePack.metadata.name,
        status: selectedKnowledgePack.metadata.status,
      };
    }

    if (
      initialSelectionMatchesWorkingDir &&
      initialSelectionPackName &&
      effectiveProjectRootPath
    ) {
      return {
        enabled: knowledgePackEnabled || shouldEnableInitialSelection,
        packName: initialSelectionPackName,
        workingDir: effectiveProjectRootPath,
        label: initialKnowledgePackSelection?.label || initialSelectionPackName,
        status: initialKnowledgePackSelection?.status,
      };
    }

    return null;
  }, [
    effectiveProjectRootPath,
    initialKnowledgePackSelection,
    initialSelectionMatchesWorkingDir,
    initialSelectionPackName,
    knowledgePackEnabled,
    selectedKnowledgePack,
    shouldEnableInitialSelection,
  ]);

  const handleSelectKnowledgePack = useCallback((packName: string) => {
    setSelectedKnowledgePackName(packName);
  }, []);

  const handleStartKnowledgeOrganize = useCallback(() => {
    const workingDir = effectiveProjectRootPath;
    if (!workingDir) {
      setInput(
        "请先选择一个项目，然后我会把资料整理成当前项目可复用的项目资料。",
      );
      return;
    }

    const trimmedInput = input.trim();
    const packName = normalizeKnowledgeDraftName(
      selectedKnowledgePack?.metadata.name ||
        selectedKnowledgePack?.metadata.description ||
        currentSessionTitle ||
        "project-material",
    );
    const prompt = buildKnowledgeOrganizePrompt(trimmedInput);
    const requestMetadata = buildKnowledgeBuilderMetadata({
      workingDir,
      packName,
      source: "inputbar",
    });

    if (!trimmedInput) {
      setInput(prompt);
      return;
    }

    void handleSend(
      undefined,
      false,
      false,
      prompt,
      executionStrategy || "react",
      undefined,
      {
        requestMetadata,
        displayContent: prompt,
      },
    );
  }, [
    currentSessionTitle,
    effectiveProjectRootPath,
    executionStrategy,
    handleSend,
    input,
    selectedKnowledgePack,
    setInput,
  ]);

  const handleManageKnowledgePacks = useMemo(
    () =>
      onOpenKnowledgeManagement
        ? () => onOpenKnowledgeManagement(effectiveProjectRootPath)
        : undefined,
    [effectiveProjectRootPath, onOpenKnowledgeManagement],
  );

  const handleKnowledgeImportSuccess = useCallback(
    async (
      workingDir: string,
      packName: string,
      description?: string | null,
    ) => {
      await refreshKnowledgePacks(workingDir, packName);
      setKnowledgePackEnabled(false);
      toast.success("项目资料已整理，确认后可用于生成", {
        description: description || undefined,
      });
    },
    [refreshKnowledgePacks],
  );

  const handleImportPathReferenceAsKnowledge = useCallback(
    (reference: MessagePathReference) => {
      const workingDir = effectiveProjectRootPath;
      if (!workingDir) {
        toast.error("请先选择一个项目，再添加项目资料。");
        return;
      }
      if (reference.isDir) {
        toast.info(
          "文件夹暂时只能添加到对话，请选择 Markdown 或文本文件作为项目资料。",
        );
        return;
      }
      const unsupportedMessage = getKnowledgeUnsupportedSourceMessage(reference);
      if (unsupportedMessage) {
        toast.info(unsupportedMessage);
        return;
      }

      toast.info(`正在整理项目资料：${reference.name}`);
      void importKnowledgePathSource({
        workingDir,
        source: reference,
      })
        .then(async (result) => {
          await handleKnowledgeImportSuccess(
            workingDir,
            result.pack.metadata.name,
            result.pack.metadata.description,
          );
        })
        .catch((error) => {
          console.error("导入项目资料失败:", error);
          toast.error(
            error instanceof Error && error.message.trim()
              ? error.message
              : "导入项目资料失败，请稍后重试。",
          );
        });
    },
    [effectiveProjectRootPath, handleKnowledgeImportSuccess],
  );

  const handleImportTextAsKnowledge = useCallback(
    (source: {
      sourceName: string;
      sourceText: string;
      description?: string | null;
      packType?: string | null;
    }) => {
      const workingDir = effectiveProjectRootPath;
      if (!workingDir) {
        toast.error("请先选择一个项目，再添加项目资料。");
        return;
      }

      toast.info(`正在整理项目资料：${source.sourceName}`);
      void importKnowledgeTextSource({
        workingDir,
        sourceName: source.sourceName,
        sourceText: source.sourceText,
        description: source.description,
        packType: source.packType,
      })
        .then(async (result) => {
          await handleKnowledgeImportSuccess(
            workingDir,
            result.pack.metadata.name,
            result.pack.metadata.description,
          );
        })
        .catch((error) => {
          console.error("沉淀项目资料失败:", error);
          toast.error(
            error instanceof Error && error.message.trim()
              ? error.message
              : "沉淀项目资料失败，请稍后重试。",
          );
        });
    },
    [effectiveProjectRootPath, handleKnowledgeImportSuccess],
  );

  return {
    knowledgePackSelection,
    knowledgePackOptions,
    onToggleKnowledgePack: setKnowledgePackEnabled,
    onSelectKnowledgePack: handleSelectKnowledgePack,
    onStartKnowledgeOrganize: handleStartKnowledgeOrganize,
    onManageKnowledgePacks: handleManageKnowledgePacks,
    onImportPathReferenceAsKnowledge: handleImportPathReferenceAsKnowledge,
    onImportTextAsKnowledge: handleImportTextAsKnowledge,
  };
}
