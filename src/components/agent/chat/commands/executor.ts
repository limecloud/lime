import {
  buildCodexSlashHelpMessage,
  buildCodexSlashModelMessage,
  buildCodexSlashPrompt,
  buildCodexSlashStatusMessage,
  buildUnsupportedCodexSlashCommandMessage,
} from "./formatter";
import type { ExecuteCodexSlashCommandParams } from "./types";

function ensureSessionMutationAllowed(
  isSending: boolean,
  commandPrefix: string,
  notifyInfo: (message: string) => void,
): boolean {
  if (!isSending) {
    return true;
  }

  notifyInfo(
    `当前仍有任务执行中，请先等待结束或停止生成后再执行 ${commandPrefix}`,
  );
  return false;
}

export async function executeCodexSlashCommand(
  params: ExecuteCodexSlashCommandParams,
): Promise<boolean> {
  const {
    command,
    statusSnapshot,
    sendPrompt,
    compactSession,
    clearMessages,
    createFreshSession,
    appendAssistantMessage,
    notifyInfo,
    onExecutedCommand,
  } = params;

  switch (command.definition.key) {
    case "compact":
      await compactSession();
      onExecutedCommand?.(command);
      return true;
    case "clear":
      if (
        !ensureSessionMutationAllowed(
          statusSnapshot.isSending,
          command.definition.commandPrefix,
          notifyInfo,
        )
      ) {
        return true;
      }
      clearMessages({ toastMessage: "已清空当前任务" });
      onExecutedCommand?.(command);
      return true;
    case "new": {
      if (
        !ensureSessionMutationAllowed(
          statusSnapshot.isSending,
          command.definition.commandPrefix,
          notifyInfo,
        )
      ) {
        return true;
      }
      const sessionName = command.userInput.trim() || undefined;
      await createFreshSession(sessionName);
      onExecutedCommand?.(command);
      return true;
    }
    case "help":
      appendAssistantMessage(buildCodexSlashHelpMessage());
      onExecutedCommand?.(command);
      return true;
    case "status":
      appendAssistantMessage(buildCodexSlashStatusMessage(statusSnapshot));
      onExecutedCommand?.(command);
      return true;
    case "model":
      if (command.userInput.trim()) {
        notifyInfo(
          "当前暂不支持通过 /model 切换模型，请使用输入框右侧的模型选择器",
        );
        return true;
      }
      appendAssistantMessage(buildCodexSlashModelMessage(statusSnapshot));
      onExecutedCommand?.(command);
      return true;
    case "review":
    case "diff":
    case "init": {
      const prompt = buildCodexSlashPrompt(command);
      if (prompt) {
        await sendPrompt(prompt);
        onExecutedCommand?.(command);
        return true;
      }
      return false;
    }
    default:
      if (command.definition.support === "unsupported") {
        notifyInfo(buildUnsupportedCodexSlashCommandMessage(command));
        return true;
      }
      return false;
  }
}
