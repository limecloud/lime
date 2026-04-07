import {
  parseSkillSlashCommand,
  tryExecuteSlashSkillCommand,
} from "./skillCommand";
import { extractExistingHarnessMetadata } from "../utils/harnessRequestMetadata";
import type { PreparedAgentStreamUserInputSend } from "./agentStreamUserInputSendPreparation";
import type { AgentStreamPreparedSendEnv } from "./agentStreamPreparedSendEnv";

type SlashSkillPreflightEnv = Pick<
  AgentStreamPreparedSendEnv,
  | "ensureSession"
  | "sessionIdRef"
  | "activeStreamRef"
  | "listenerMapRef"
  | "setMessages"
  | "setIsSending"
  | "setActiveStream"
  | "clearActiveStreamIfMatch"
  | "playTypewriterSound"
  | "playToolcallSound"
  | "onWriteFile"
>;

interface MaybeHandleSlashSkillBeforeSendOptions {
  preparedSend: PreparedAgentStreamUserInputSend;
  env: SlashSkillPreflightEnv;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function hasStructuredSlashLaunchMetadata(
  requestMetadata?: Record<string, unknown>,
): boolean {
  const harness = extractExistingHarnessMetadata(requestMetadata);
  if (!harness) {
    return false;
  }

  const launch =
    asRecord(harness.service_scene_launch) ??
    asRecord(harness.serviceSceneLaunch) ??
    asRecord(harness.service_skill_launch) ??
    asRecord(harness.serviceSkillLaunch);

  return Boolean(launch && Object.keys(launch).length > 0);
}

export async function maybeHandleSlashSkillBeforeSend(
  options: MaybeHandleSlashSkillBeforeSendOptions,
): Promise<boolean> {
  const { preparedSend, env } = options;
  const {
    content,
    skipUserMessage,
    expectingQueue,
    assistantMsgId,
    effectiveProviderType,
    effectiveModel,
  } = preparedSend;

  if (skipUserMessage || expectingQueue) {
    return false;
  }

  if (hasStructuredSlashLaunchMetadata(preparedSend.requestMetadata)) {
    return false;
  }

  const parsedSkillCommand = parseSkillSlashCommand(content);
  if (!parsedSkillCommand) {
    return false;
  }

  const skillEventName = `skill-exec-${assistantMsgId}`;
  env.setActiveStream({
    assistantMsgId,
    eventName: skillEventName,
    sessionId: env.sessionIdRef.current || "",
  });

  const skillHandled = await tryExecuteSlashSkillCommand({
    command: parsedSkillCommand,
    rawContent: content,
    assistantMsgId,
    providerType: effectiveProviderType,
    model: effectiveModel || undefined,
    images: preparedSend.skillRequest?.images ?? preparedSend.images,
    requestContext: preparedSend.skillRequest?.requestContext,
    ensureSession: env.ensureSession,
    setMessages: env.setMessages,
    setIsSending: env.setIsSending,
    setCurrentAssistantMsgId: (id) => {
      if (!id) {
        env.clearActiveStreamIfMatch(skillEventName);
        return;
      }
      env.setActiveStream({
        assistantMsgId: id,
        eventName: skillEventName,
        sessionId:
          env.activeStreamRef.current?.sessionId ||
          env.sessionIdRef.current ||
          "",
      });
    },
    setStreamUnlisten: (unlistenFn) => {
      const previous = env.listenerMapRef.current.get(skillEventName);
      if (previous) {
        previous();
        env.listenerMapRef.current.delete(skillEventName);
      }
      if (unlistenFn) {
        env.listenerMapRef.current.set(skillEventName, unlistenFn);
      }
    },
    setActiveSessionIdForStop: (sessionIdForStop) => {
      if (!sessionIdForStop) {
        env.clearActiveStreamIfMatch(skillEventName);
        return;
      }
      env.setActiveStream({
        assistantMsgId:
          env.activeStreamRef.current?.assistantMsgId || assistantMsgId,
        eventName: skillEventName,
        sessionId: sessionIdForStop,
        pendingTurnKey: env.activeStreamRef.current?.pendingTurnKey,
        pendingItemKey: env.activeStreamRef.current?.pendingItemKey,
      });
    },
    isExecutionCancelled: () =>
      env.activeStreamRef.current?.assistantMsgId !== assistantMsgId,
    playTypewriterSound: env.playTypewriterSound,
    playToolcallSound: env.playToolcallSound,
    onWriteFile: env.onWriteFile,
  });

  if (skillHandled) {
    return true;
  }

  env.clearActiveStreamIfMatch(skillEventName);
  return false;
}
