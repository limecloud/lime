import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { createInitialDocumentState } from "@/lib/workspace/workbenchCanvas";
import type { CanvasStateUnion } from "@/lib/workspace/workbenchCanvas";
import {
  createInitialNovelState,
  countWords as countNovelWords,
} from "@/lib/workspace/workbenchCanvas";
import type { ThemeType } from "@/lib/workspace/workbenchContract";
import type { Message } from "../types";
import { isCanvasStateEmpty } from "./themeWorkbenchHelpers";

interface UseWorkspaceCanvasMessageSyncRuntimeParams {
  canvasState: CanvasStateUnion | null;
  isContentCreationMode: boolean;
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

function looksLikeSerializedNovelState(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) {
    return false;
  }

  const jsonCandidate =
    trimmed.match(/^```json\s*([\s\S]*?)```$/i)?.[1] || trimmed;

  if (!(jsonCandidate.startsWith("[") || jsonCandidate.startsWith("{"))) {
    return false;
  }

  return (
    jsonCandidate.includes('"title"') &&
    (jsonCandidate.includes('"number"') || jsonCandidate.includes('"chapters"'))
  );
}

export function useWorkspaceCanvasMessageSyncRuntime({
  canvasState,
  isContentCreationMode,
  isThemeWorkbench,
  mappedTheme,
  messages,
  processedMessageIdsRef,
  setCanvasState,
}: UseWorkspaceCanvasMessageSyncRuntimeParams) {
  const upsertNovelCanvasState = useCallback(
    (previous: CanvasStateUnion | null, content: string): CanvasStateUnion => {
      if (!previous || previous.type !== "novel") {
        return createInitialNovelState(content);
      }

      if (looksLikeSerializedNovelState(content)) {
        return createInitialNovelState(content);
      }

      const targetChapterId =
        previous.currentChapterId ||
        previous.chapters[0]?.id ||
        crypto.randomUUID();
      const now = Date.now();

      if (previous.chapters.length === 0) {
        const initialized = createInitialNovelState(content);
        return {
          ...initialized,
          currentChapterId: initialized.chapters[0]?.id || targetChapterId,
        };
      }

      return {
        ...previous,
        chapters: previous.chapters.map((chapter) =>
          chapter.id === targetChapterId
            ? {
                ...chapter,
                content,
                wordCount: countNovelWords(content),
                updatedAt: now,
              }
            : chapter,
        ),
      };
    },
    [],
  );

  useEffect(() => {
    if (!isContentCreationMode) {
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
      if (mappedTheme === "poster") {
        return previous;
      }

      if (mappedTheme === "novel") {
        return upsertNovelCanvasState(previous, documentContent);
      }

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
    isContentCreationMode,
    isThemeWorkbench,
    mappedTheme,
    messages,
    processedMessageIdsRef,
    setCanvasState,
    upsertNovelCanvasState,
  ]);

  return {
    upsertNovelCanvasState,
  };
}
