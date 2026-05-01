import { useCallback } from "react";
import type { AutoContinueRequestPayload } from "@/lib/api/agentRuntime";
import type { MessageImage, MessagePathReference } from "../../../types";
import type { HandleSendOptions } from "../../../hooks/handleSendTypes";
import type { InputbarKnowledgePackSelection } from "../types";
import { recordCuratedTaskTemplateUsage } from "../../../utils/curatedTaskTemplates";
import { buildPathReferenceRequestMetadata } from "../../../utils/pathReferences";
import {
  resolveInputCapabilityDispatch,
  type InputCapabilitySelection,
} from "../../../skill-selection/inputCapabilitySelection";

interface UseInputbarSendParams {
  input: string;
  pendingImages: MessageImage[];
  pathReferences: MessagePathReference[];
  webSearchEnabled: boolean;
  thinkingEnabled: boolean;
  executionStrategy?: "react" | "code_orchestrated" | "auto";
  activeCapability: InputCapabilitySelection | null;
  knowledgePackSelection?: InputbarKnowledgePackSelection | null;
  onSend: (
    images?: MessageImage[],
    webSearch?: boolean,
    thinking?: boolean,
    textOverride?: string,
    executionStrategy?: "react" | "code_orchestrated" | "auto",
    autoContinuePayload?: AutoContinueRequestPayload,
    sendOptions?: HandleSendOptions,
  ) => void | Promise<boolean> | boolean;
  clearPendingImages: () => void;
  clearPathReferences?: () => void;
  clearActiveCapability: () => void;
}

export function useInputbarSend({
  input,
  pendingImages,
  pathReferences,
  webSearchEnabled,
  thinkingEnabled,
  executionStrategy,
  activeCapability,
  knowledgePackSelection,
  onSend,
  clearPendingImages,
  clearPathReferences,
  clearActiveCapability,
}: UseInputbarSendParams) {
  return useCallback(async () => {
    if (
      !input.trim() &&
      pendingImages.length === 0 &&
      pathReferences.length === 0
    ) {
      return;
    }

    const webSearch = webSearchEnabled;
    const thinking = thinkingEnabled;
    let strategy = executionStrategy || "react";

    if (webSearch && strategy !== "react") {
      strategy = "react";
    }

    const capabilityDispatch = resolveInputCapabilityDispatch(
      activeCapability,
      input,
    );
    const baseRequestMetadata = buildPathReferenceRequestMetadata(
      capabilityDispatch.requestMetadata,
      pathReferences,
    );
    const requestMetadata =
      knowledgePackSelection?.enabled &&
      knowledgePackSelection.packName.trim() &&
      knowledgePackSelection.workingDir.trim()
        ? {
            ...(baseRequestMetadata || {}),
            knowledge_pack: {
              pack_name: knowledgePackSelection.packName.trim(),
              working_dir: knowledgePackSelection.workingDir.trim(),
              source: "inputbar",
            },
          }
        : baseRequestMetadata;
    const hasPathReferences = pathReferences.length > 0;
    const textOverride = input.trim()
      ? undefined
      : hasPathReferences
        ? "请查看这些文件或文件夹。"
        : undefined;
    const sendOptions =
      capabilityDispatch.capabilityRoute ||
      capabilityDispatch.displayContent ||
      requestMetadata
        ? {
            ...(capabilityDispatch.capabilityRoute
              ? { capabilityRoute: capabilityDispatch.capabilityRoute }
              : {}),
            ...(capabilityDispatch.displayContent || input.trim()
              ? {
                  displayContent:
                    capabilityDispatch.displayContent ||
                    (input.trim() ? input : undefined),
                }
              : {}),
            ...(requestMetadata ? { requestMetadata } : {}),
          }
        : undefined;

    try {
      const result = await onSend(
        pendingImages.length > 0 ? pendingImages : undefined,
        webSearch,
        thinking,
        textOverride,
        strategy,
        undefined,
        sendOptions,
      );
      if (result === false) {
        return;
      }
      if (activeCapability?.kind === "curated_task") {
        recordCuratedTaskTemplateUsage({
          templateId: activeCapability.task.id,
          launchInputValues: activeCapability.launchInputValues,
          referenceMemoryIds: activeCapability.referenceMemoryIds,
          referenceEntries: activeCapability.referenceEntries,
        });
      }
      clearPendingImages();
      clearPathReferences?.();
      clearActiveCapability();
    } catch {
      // 发送失败时保留图片与技能，交由上层 toast / 恢复逻辑处理。
    }
  }, [
    activeCapability,
    clearActiveCapability,
    clearPendingImages,
    clearPathReferences,
    executionStrategy,
    input,
    knowledgePackSelection,
    onSend,
    pendingImages,
    pathReferences,
    thinkingEnabled,
    webSearchEnabled,
  ]);
}
