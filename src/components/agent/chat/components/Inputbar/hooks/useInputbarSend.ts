import { useCallback } from "react";
import type { Skill } from "@/lib/api/skills";
import type { MessageImage } from "../../../types";
import type { BuiltinInputCommand } from "../../../skill-selection/builtinCommands";

interface UseInputbarSendParams {
  input: string;
  pendingImages: MessageImage[];
  webSearchEnabled: boolean;
  thinkingEnabled: boolean;
  executionStrategy?: "react" | "code_orchestrated" | "auto";
  activeSkill: Skill | null;
  activeBuiltinCommand: BuiltinInputCommand | null;
  onSend: (
    images?: MessageImage[],
    webSearch?: boolean,
    thinking?: boolean,
    textOverride?: string,
    executionStrategy?: "react" | "code_orchestrated" | "auto",
  ) => void | Promise<boolean> | boolean;
  clearPendingImages: () => void;
  clearActiveSkill: () => void;
  clearActiveBuiltinCommand: () => void;
}

export function useInputbarSend({
  input,
  pendingImages,
  webSearchEnabled,
  thinkingEnabled,
  executionStrategy,
  activeSkill,
  activeBuiltinCommand,
  onSend,
  clearPendingImages,
  clearActiveSkill,
  clearActiveBuiltinCommand,
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

    let textOverride: string | undefined;
    if (activeBuiltinCommand) {
      textOverride = `${activeBuiltinCommand.commandPrefix} ${input}`.trim();
    } else if (activeSkill) {
      textOverride = `/${activeSkill.key} ${input}`.trim();
    }

    try {
      const result = await onSend(
        pendingImages.length > 0 ? pendingImages : undefined,
        webSearch,
        thinking,
        textOverride,
        strategy,
      );
      if (result === false) {
        return;
      }
      clearPendingImages();
      clearActiveSkill();
      clearActiveBuiltinCommand();
    } catch {
      // 发送失败时保留图片与技能，交由上层 toast / 恢复逻辑处理。
    }
  }, [
    activeBuiltinCommand,
    activeSkill,
    clearActiveBuiltinCommand,
    clearActiveSkill,
    clearPendingImages,
    executionStrategy,
    input,
    onSend,
    pendingImages,
    thinkingEnabled,
    webSearchEnabled,
  ]);
}
