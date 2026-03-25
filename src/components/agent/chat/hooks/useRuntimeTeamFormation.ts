import { useCallback } from "react";
import type { HandleSendOptions } from "./handleSendTypes";
import {
  createRuntimeFormationStateFromTeam,
  type TeamWorkspaceRuntimeFormationState,
} from "../teamWorkspaceRuntime";
import type { TeamDefinition } from "../utils/teamDefinitions";

interface PrepareRuntimeTeamBeforeSendParams {
  input: string;
  purpose?: HandleSendOptions["purpose"];
  subagentEnabled?: boolean;
}

interface UseRuntimeTeamFormationOptions {
  projectId?: string | null;
  sessionId?: string | null;
  selectedTeam?: TeamDefinition | null;
  subagentEnabled: boolean;
  hasRealTeamGraph: boolean;
  createRequestId?: () => string;
  now?: () => number;
}

export interface UseRuntimeTeamFormationResult {
  clearRuntimeTeamState: () => void;
  prepareRuntimeTeamBeforeSend: (
    params: PrepareRuntimeTeamBeforeSendParams,
  ) => Promise<TeamWorkspaceRuntimeFormationState | null>;
}

function defaultCreateRequestId() {
  return crypto.randomUUID();
}

export function shouldPrepareRuntimeTeamBeforeSend(params: {
  subagentEnabled: boolean;
  projectId?: string | null;
  input: string;
  purpose?: HandleSendOptions["purpose"];
}): boolean {
  if (!params.subagentEnabled || params.purpose || !params.projectId) {
    return false;
  }

  const trimmed = params.input.trim();
  if (trimmed.length === 0) {
    return false;
  }

  // 短输入（少于 40 字符）大概率是简单请求，不需要团队协作
  if (trimmed.length < 40) {
    return false;
  }

  // 检测是否为简单内容生成类请求（生成提纲、写报告等），这类任务单 agent 即可完成
  const simpleGenerationPatterns = [
    /^(请|帮我|帮忙)?(生成|写|起草|草拟|撰写|创建|制作|输出)/,
    /^(generate|write|create|draft|make)\b/i,
  ];
  if (simpleGenerationPatterns.some((pattern) => pattern.test(trimmed))) {
    return false;
  }

  return true;
}

export function useRuntimeTeamFormation({
  projectId,
  selectedTeam,
  subagentEnabled,
  createRequestId = defaultCreateRequestId,
  now = () => Date.now(),
}: UseRuntimeTeamFormationOptions): UseRuntimeTeamFormationResult {
  const clearRuntimeTeamState = useCallback(() => {
    return;
  }, []);

  const formRuntimeTeamState = useCallback(() => {
    if (!selectedTeam) {
      return null;
    }

    const formedState = createRuntimeFormationStateFromTeam({
      requestId: createRequestId(),
      status: "formed",
      runtimeTeam: selectedTeam,
      blueprintTeam: selectedTeam,
      updatedAt: now(),
    });
    return formedState;
  }, [createRequestId, now, selectedTeam]);

  const prepareRuntimeTeamBeforeSend = useCallback(
    ({
      input,
      purpose,
      subagentEnabled: subagentEnabledOverride,
    }: PrepareRuntimeTeamBeforeSendParams) => {
      const effectiveSubagentEnabled =
        subagentEnabledOverride ?? subagentEnabled;
      if (
        shouldPrepareRuntimeTeamBeforeSend({
          subagentEnabled: effectiveSubagentEnabled,
          projectId,
          input,
          purpose,
        }) &&
        selectedTeam
      ) {
        return Promise.resolve(formRuntimeTeamState());
      }

      return Promise.resolve(null);
    },
    [formRuntimeTeamState, projectId, selectedTeam, subagentEnabled],
  );

  return {
    clearRuntimeTeamState,
    prepareRuntimeTeamBeforeSend,
  };
}
