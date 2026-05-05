import { useCallback, useEffect, useMemo, useState } from "react";
import type { AutoContinueRequestPayload } from "@/lib/api/agentRuntime";
import { listKnowledgePacks, type KnowledgePackSummary } from "@/lib/api/knowledge";
import {
  buildKnowledgeOrganizePrompt,
  normalizeKnowledgeDraftName,
} from "@/features/knowledge/agent/knowledgePromptBuilder";
import { buildKnowledgeBuilderMetadata } from "@/features/knowledge/agent/knowledgeMetadata";
import type {
  InputbarKnowledgePackOption,
  InputbarKnowledgePackSelection,
} from "../../components/Inputbar/types";
import type { HandleSendOptions } from "../../hooks/handleSendTypes";
import type { MessageImage } from "../../types";

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

interface UseWorkspaceKnowledgeRuntimeParams {
  projectRootPath?: string | null;
  currentSessionTitle?: string | null;
  input: string;
  setInput: (value: string) => void;
  executionStrategy?: KnowledgeExecutionStrategy;
  handleSend: WorkspaceKnowledgeHandleSend;
  onOpenKnowledgeManagement?: (workingDir?: string | null) => void;
}

interface UseWorkspaceKnowledgeRuntimeResult {
  knowledgePackSelection: InputbarKnowledgePackSelection | null;
  knowledgePackOptions: InputbarKnowledgePackOption[];
  onToggleKnowledgePack: (enabled: boolean) => void;
  onSelectKnowledgePack: (packName: string) => void;
  onStartKnowledgeOrganize: () => void;
  onManageKnowledgePacks?: () => void;
}

export function useWorkspaceKnowledgeRuntime({
  projectRootPath,
  currentSessionTitle,
  input,
  setInput,
  executionStrategy,
  handleSend,
  onOpenKnowledgeManagement,
}: UseWorkspaceKnowledgeRuntimeParams): UseWorkspaceKnowledgeRuntimeResult {
  const [knowledgePacks, setKnowledgePacks] = useState<KnowledgePackSummary[]>(
    [],
  );
  const [selectedKnowledgePackName, setSelectedKnowledgePackName] = useState<
    string | null
  >(null);
  const [knowledgePackEnabled, setKnowledgePackEnabled] = useState(false);

  useEffect(() => {
    const workingDir = projectRootPath?.trim();
    if (!workingDir) {
      setKnowledgePacks([]);
      setSelectedKnowledgePackName(null);
      setKnowledgePackEnabled(false);
      return;
    }

    let cancelled = false;
    listKnowledgePacks({ workingDir, includeArchived: false })
      .then((response) => {
        if (cancelled) {
          return;
        }
        const nextDefaultPack =
          response.packs.find((pack) => pack.defaultForWorkspace) ??
          response.packs[0] ??
          null;
        setKnowledgePacks(response.packs);
        setSelectedKnowledgePackName((current) => {
          if (
            current &&
            response.packs.some((pack) => pack.metadata.name === current)
          ) {
            return current;
          }

          return nextDefaultPack?.metadata.name ?? null;
        });
        setKnowledgePackEnabled(false);
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
  }, [projectRootPath]);

  const selectedKnowledgePack = useMemo(() => {
    if (knowledgePacks.length === 0) {
      return null;
    }

    return (
      knowledgePacks.find(
        (pack) => pack.metadata.name === selectedKnowledgePackName,
      ) ??
      knowledgePacks.find((pack) => pack.defaultForWorkspace) ??
      knowledgePacks[0] ??
      null
    );
  }, [knowledgePacks, selectedKnowledgePackName]);

  const knowledgePackOptions = useMemo(
    () =>
      knowledgePacks.map((pack) => ({
        packName: pack.metadata.name,
        label: pack.metadata.description || pack.metadata.name,
        status: pack.metadata.status,
        defaultForWorkspace: pack.defaultForWorkspace,
      })),
    [knowledgePacks],
  );

  const knowledgePackSelection = useMemo(
    () =>
      selectedKnowledgePack && projectRootPath
        ? {
            enabled: knowledgePackEnabled,
            packName: selectedKnowledgePack.metadata.name,
            workingDir: projectRootPath,
            label:
              selectedKnowledgePack.metadata.description ||
              selectedKnowledgePack.metadata.name,
            status: selectedKnowledgePack.metadata.status,
          }
        : null,
    [selectedKnowledgePack, knowledgePackEnabled, projectRootPath],
  );

  const handleSelectKnowledgePack = useCallback((packName: string) => {
    setSelectedKnowledgePackName(packName);
  }, []);

  const handleStartKnowledgeOrganize = useCallback(() => {
    const workingDir = projectRootPath?.trim();
    if (!workingDir) {
      setInput("请先选择一个项目，然后我会把资料整理成当前项目可复用的项目资料。");
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
    executionStrategy,
    handleSend,
    input,
    projectRootPath,
    selectedKnowledgePack,
    setInput,
  ]);

  const handleManageKnowledgePacks = useMemo(
    () =>
      onOpenKnowledgeManagement
        ? () => onOpenKnowledgeManagement(projectRootPath)
        : undefined,
    [onOpenKnowledgeManagement, projectRootPath],
  );

  return {
    knowledgePackSelection,
    knowledgePackOptions,
    onToggleKnowledgePack: setKnowledgePackEnabled,
    onSelectKnowledgePack: handleSelectKnowledgePack,
    onStartKnowledgeOrganize: handleStartKnowledgeOrganize,
    onManageKnowledgePacks: handleManageKnowledgePacks,
  };
}
