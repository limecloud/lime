import type {
  AutoContinueRequestPayload,
  AsterExecutionStrategy,
} from "@/lib/api/agentRuntime";
import type { MessageImage } from "../types";
import type { SendMessageOptions } from "./agentChatShared";
import { dispatchPreparedAgentStreamSend } from "./agentStreamPreparedSendDispatch";
import type { AgentStreamPreparedSendEnv } from "./agentStreamPreparedSendEnv";
import { prepareAgentStreamUserInputSend } from "./agentStreamUserInputSendPreparation";

interface SendAgentStreamMessageOptions {
  content: string;
  images: MessageImage[];
  webSearch?: boolean;
  thinking?: boolean;
  skipUserMessage?: boolean;
  executionStrategyOverride?: AsterExecutionStrategy;
  modelOverride?: string;
  autoContinue?: AutoContinueRequestPayload;
  systemPrompt?: string;
  options?: SendMessageOptions;
  env: AgentStreamPreparedSendEnv;
}

export async function sendAgentStreamMessage(
  options: SendAgentStreamMessageOptions,
) {
  const {
    content,
    images,
    webSearch,
    thinking,
    skipUserMessage = false,
    executionStrategyOverride,
    modelOverride,
    autoContinue,
    systemPrompt,
    options: sendOptions,
    env,
  } = options;

  const preparedSend = prepareAgentStreamUserInputSend({
    content,
    images,
    webSearch,
    thinking,
    skipUserMessage,
    executionStrategyOverride,
    modelOverride,
    autoContinue,
    systemPrompt,
    options: sendOptions,
    env,
  });

  await dispatchPreparedAgentStreamSend({
    preparedSend,
    env,
  });
}
