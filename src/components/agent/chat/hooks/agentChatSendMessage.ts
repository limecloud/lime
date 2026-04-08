import type { CodexSlashStatusSnapshot } from "../commands";
import { executeCodexSlashCommand, parseCodexSlashCommand } from "../commands";
import { recordSlashEntryUsage } from "../skill-selection/slashEntryUsage";
import type { ClearMessagesOptions, SendMessageFn } from "./agentChatShared";

interface CreateAgentChatSendMessageOptions {
  baseStatusSnapshot: CodexSlashStatusSnapshot;
  rawSendMessage: SendMessageFn;
  compactSession: () => Promise<void>;
  clearMessages: (options?: ClearMessagesOptions) => void;
  createFreshSession: (sessionName?: string) => Promise<string | null>;
  appendAssistantMessage: (content: string) => void;
  notifyInfo: (message: string) => void;
  notifySuccess: (message: string) => void;
}

export function createAgentChatSendMessage(
  options: CreateAgentChatSendMessageOptions,
): SendMessageFn {
  const {
    baseStatusSnapshot,
    rawSendMessage,
    compactSession,
    clearMessages,
    createFreshSession,
    appendAssistantMessage,
    notifyInfo,
    notifySuccess,
  } = options;

  return async (
    content,
    images,
    webSearch,
    thinking,
    skipUserMessage,
    executionStrategyOverride,
    modelOverride,
    autoContinue,
    sendOptions,
  ) => {
    if (!skipUserMessage) {
      const parsedCodexCommand = parseCodexSlashCommand(content);
      if (parsedCodexCommand) {
        const effectiveModel =
          modelOverride?.trim() || baseStatusSnapshot.model;
        const effectiveExecutionStrategy =
          executionStrategyOverride || baseStatusSnapshot.executionStrategy;
        const handled = await executeCodexSlashCommand({
          command: parsedCodexCommand,
          statusSnapshot: {
            ...baseStatusSnapshot,
            model: effectiveModel,
            executionStrategy: effectiveExecutionStrategy,
          },
          sendPrompt: async (prompt) => {
            await rawSendMessage(
              prompt,
              images,
              webSearch,
              thinking,
              skipUserMessage,
              executionStrategyOverride,
              modelOverride,
              autoContinue,
              sendOptions,
            );
          },
          compactSession,
          clearMessages,
          createFreshSession,
          appendAssistantMessage,
          notifyInfo,
          notifySuccess,
          onExecutedCommand: (command) => {
            if (command.definition.support !== "supported") {
              return;
            }

            recordSlashEntryUsage({
              kind: "command",
              entryId: command.definition.key,
              replayText: command.userInput,
            });
          },
        });
        if (handled) {
          return;
        }
      }
    }

    await rawSendMessage(
      content,
      images,
      webSearch,
      thinking,
      skipUserMessage,
      executionStrategyOverride,
      modelOverride,
      autoContinue,
      sendOptions,
    );
  };
}
