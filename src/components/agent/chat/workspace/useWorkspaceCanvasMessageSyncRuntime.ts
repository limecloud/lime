import {
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { createInitialDocumentState } from "@/lib/workspace/workbenchCanvas";
import type { CanvasStateUnion } from "@/lib/workspace/workbenchCanvas";
import type { ThemeType } from "@/lib/workspace/workbenchContract";
import type { Message } from "../types";
import { isCanvasStateEmpty } from "./generalWorkbenchHelpers";

interface UseWorkspaceCanvasMessageSyncRuntimeParams {
  canvasState: CanvasStateUnion | null;
  isSpecializedThemeMode: boolean;
  isThemeWorkbench: boolean;
  mappedTheme: ThemeType;
  messages: Message[];
  processedMessageIdsRef: MutableRefObject<Set<string>>;
  setCanvasState: Dispatch<SetStateAction<CanvasStateUnion | null>>;
}

function extractDocumentContent(
  content: string,
  isThemeWorkbench: boolean,
): string | null {
  const documentMatch = content.match(/<document>([\s\S]*?)<\/document>/);
  if (documentMatch) {
    return documentMatch[1].trim();
  }

  const markdownMatch = content.match(/```(?:markdown|md)\n([\s\S]*?)```/);
  if (markdownMatch) {
    return markdownMatch[1].trim();
  }

  if (isThemeWorkbench) {
    return null;
  }

  if (content.trim().startsWith("#") && content.length > 200) {
    return content.trim();
  }

  return null;
}
export function useWorkspaceCanvasMessageSyncRuntime({
  canvasState,
  isSpecializedThemeMode,
  isThemeWorkbench,
  mappedTheme,
  messages,
  processedMessageIdsRef,
  setCanvasState,
}: UseWorkspaceCanvasMessageSyncRuntimeParams) {
  useEffect(() => {
    if (!isSpecializedThemeMode) {
      return;
    }

    const lastAssistantMessage = [...messages]
      .reverse()
      .find(
        (message) =>
          message.role === "assistant" &&
          !message.isThinking &&
          message.content &&
          message.purpose !== "content_review" &&
          message.purpose !== "style_rewrite" &&
          message.purpose !== "style_audit",
      );

    if (!lastAssistantMessage) {
      return;
    }

    if (isThemeWorkbench) {
      const hasWriteFileToolCall = lastAssistantMessage.toolCalls?.some(
        (toolCall) => {
          const name = (toolCall.name || "").toLowerCase();
          return name.includes("write") || name.includes("create_file");
        },
      );
      if (hasWriteFileToolCall) {
        return;
      }
      if (canvasState && !isCanvasStateEmpty(canvasState)) {
        return;
      }
    }

    if (processedMessageIdsRef.current.has(lastAssistantMessage.id)) {
      return;
    }

    const documentContent = extractDocumentContent(
      lastAssistantMessage.content,
      isThemeWorkbench,
    );
    if (!documentContent) {
      return;
    }

    processedMessageIdsRef.current.add(lastAssistantMessage.id);
    setCanvasState((previous) => {
      if (!previous || previous.type !== "document") {
        return createInitialDocumentState(documentContent);
      }

      const newVersion = {
        id: crypto.randomUUID(),
        content: documentContent,
        createdAt: Date.now(),
        description: `AI 生成 - 版本 ${previous.versions.length + 1}`,
      };
      return {
        ...previous,
        content: documentContent,
        versions: [...previous.versions, newVersion],
        currentVersionId: newVersion.id,
      };
    });
  }, [
    canvasState,
    isSpecializedThemeMode,
    isThemeWorkbench,
    mappedTheme,
    messages,
    processedMessageIdsRef,
    setCanvasState,
  ]);
}
