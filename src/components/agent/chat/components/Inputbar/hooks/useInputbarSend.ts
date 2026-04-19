import { useCallback } from "react";
import type { AutoContinueRequestPayload } from "@/lib/api/agentRuntime";
import type { MessageImage } from "../../../types";
import type { HandleSendOptions } from "../../../hooks/handleSendTypes";
import {
  resolveInputCapabilityDispatch,
  type InputCapabilitySelection,
} from "../../../skill-selection/inputCapabilitySelection";

interface UseInputbarSendParams {
  input: string;
  pendingImages: MessageImage[];
  webSearchEnabled: boolean;
  thinkingEnabled: boolean;
  executionStrategy?: "react" | "code_orchestrated" | "auto";
  activeCapability: InputCapabilitySelection | null;
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
  clearActiveCapability: () => void;
}

export function useInputbarSend({
  input,
  pendingImages,
  webSearchEnabled,
  thinkingEnabled,
  executionStrategy,
  activeCapability,
  onSend,
  clearPendingImages,
  clearActiveCapability,
}: UseInputbarSendParams) {
  return useCallback(async () => {
    if (!input.trim() && pendingImages.length === 0) {
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

    try {
      const result = await onSend(
        pendingImages.length > 0 ? pendingImages : undefined,
        webSearch,
        thinking,
        undefined,
        strategy,
        undefined,
        capabilityDispatch.capabilityRoute ||
          capabilityDispatch.displayContent ||
          capabilityDispatch.requestMetadata
          ? {
              capabilityRoute: capabilityDispatch.capabilityRoute,
              displayContent: capabilityDispatch.displayContent,
              requestMetadata: capabilityDispatch.requestMetadata,
            }
          : undefined,
      );
      if (result === false) {
        return;
      }
      clearPendingImages();
      clearActiveCapability();
    } catch {
      // 发送失败时保留图片与技能，交由上层 toast / 恢复逻辑处理。
    }
  }, [
    activeCapability,
    clearActiveCapability,
    clearPendingImages,
    executionStrategy,
    input,
    onSend,
    pendingImages,
    thinkingEnabled,
    webSearchEnabled,
  ]);
}
