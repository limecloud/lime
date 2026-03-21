import { useCallback, useEffect, useRef, useState } from "react";
import type { HandleSendOptions } from "./handleSendTypes";
import {
  createRuntimeFormationStateFromTeam,
  type TeamWorkspaceRuntimeFormationState,
} from "../teamWorkspaceRuntime";
import { generateEphemeralTeamWithModel } from "../utils/teamAutoGeneration";
import type { TeamDefinition } from "../utils/teamDefinitions";

interface TriggerRuntimeTeamFormationParams {
  input: string;
  providerType: string;
  model: string;
  executionStrategy?: "react" | "code_orchestrated" | "auto";
}

interface HandleRuntimeTeamAfterSendParams
  extends TriggerRuntimeTeamFormationParams {
  purpose?: HandleSendOptions["purpose"];
}

interface UseRuntimeTeamFormationOptions {
  activeTheme: string;
  projectId?: string | null;
  sessionId?: string | null;
  selectedTeam?: TeamDefinition | null;
  subagentEnabled: boolean;
  hasRealTeamGraph: boolean;
  generateRuntimeTeam?: typeof generateEphemeralTeamWithModel;
  createRequestId?: () => string;
  now?: () => number;
}

export interface UseRuntimeTeamFormationResult {
  runtimeTeamState: TeamWorkspaceRuntimeFormationState | null;
  clearRuntimeTeamState: () => void;
  triggerRuntimeTeamFormation: (
    params: TriggerRuntimeTeamFormationParams,
  ) => void;
  handleRuntimeTeamAfterSend: (params: HandleRuntimeTeamAfterSendParams) => void;
}

function defaultCreateRequestId() {
  return crypto.randomUUID();
}

export function shouldGenerateRuntimeTeamAfterSend(params: {
  subagentEnabled: boolean;
  projectId?: string | null;
  input: string;
  purpose?: HandleSendOptions["purpose"];
}): boolean {
  return (
    params.subagentEnabled &&
    !params.purpose &&
    Boolean(params.projectId) &&
    params.input.trim().length > 0
  );
}

export function useRuntimeTeamFormation({
  activeTheme,
  projectId,
  sessionId,
  selectedTeam,
  subagentEnabled,
  hasRealTeamGraph,
  generateRuntimeTeam = generateEphemeralTeamWithModel,
  createRequestId = defaultCreateRequestId,
  now = () => Date.now(),
}: UseRuntimeTeamFormationOptions): UseRuntimeTeamFormationResult {
  const [runtimeTeamState, setRuntimeTeamState] =
    useState<TeamWorkspaceRuntimeFormationState | null>(null);
  const runtimeTeamRequestIdRef = useRef<string | null>(null);

  const clearRuntimeTeamState = useCallback(() => {
    runtimeTeamRequestIdRef.current = null;
    setRuntimeTeamState(null);
  }, []);

  const triggerRuntimeTeamFormation = useCallback(
    ({
      input,
      providerType,
      model,
      executionStrategy,
    }: TriggerRuntimeTeamFormationParams) => {
      const normalizedInput = input.trim();
      if (!projectId || !normalizedInput) {
        return;
      }

      const requestId = createRequestId();
      runtimeTeamRequestIdRef.current = requestId;
      setRuntimeTeamState(
        createRuntimeFormationStateFromTeam({
          requestId,
          status: "forming",
          blueprintTeam: selectedTeam ?? null,
          updatedAt: now(),
        }),
      );

      void generateRuntimeTeam({
        workspaceId: projectId,
        providerType,
        model,
        executionStrategy,
        activeTheme,
        input: normalizedInput,
        blueprintTeam: selectedTeam ?? null,
      })
        .then((runtimeTeam) => {
          if (runtimeTeamRequestIdRef.current !== requestId) {
            return;
          }

          setRuntimeTeamState(
            createRuntimeFormationStateFromTeam({
              requestId,
              status: "formed",
              runtimeTeam,
              blueprintTeam: selectedTeam ?? null,
              updatedAt: now(),
            }),
          );
        })
        .catch((error) => {
          if (runtimeTeamRequestIdRef.current !== requestId) {
            return;
          }

          const errorMessage =
            error instanceof Error ? error.message : "Team 生成失败";
          setRuntimeTeamState(
            createRuntimeFormationStateFromTeam({
              requestId,
              status: "failed",
              blueprintTeam: selectedTeam ?? null,
              errorMessage,
              updatedAt: now(),
            }),
          );
        });
    },
    [
      activeTheme,
      createRequestId,
      generateRuntimeTeam,
      now,
      projectId,
      selectedTeam,
    ],
  );

  const handleRuntimeTeamAfterSend = useCallback(
    ({
      input,
      providerType,
      model,
      executionStrategy,
      purpose,
    }: HandleRuntimeTeamAfterSendParams) => {
      if (
        shouldGenerateRuntimeTeamAfterSend({
          subagentEnabled,
          projectId,
          input,
          purpose,
        })
      ) {
        triggerRuntimeTeamFormation({
          input,
          providerType,
          model,
          executionStrategy,
        });
        return;
      }

      if (!subagentEnabled && !hasRealTeamGraph) {
        clearRuntimeTeamState();
      }
    },
    [
      clearRuntimeTeamState,
      hasRealTeamGraph,
      projectId,
      subagentEnabled,
      triggerRuntimeTeamFormation,
    ],
  );

  useEffect(() => {
    clearRuntimeTeamState();
  }, [clearRuntimeTeamState, sessionId]);

  useEffect(() => {
    if (!subagentEnabled && !hasRealTeamGraph) {
      clearRuntimeTeamState();
    }
  }, [clearRuntimeTeamState, hasRealTeamGraph, subagentEnabled]);

  return {
    runtimeTeamState,
    clearRuntimeTeamState,
    triggerRuntimeTeamFormation,
    handleRuntimeTeamAfterSend,
  };
}
