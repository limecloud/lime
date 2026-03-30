import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import type { CanvasStateUnion } from "@/lib/workspace/workbenchCanvas";
import type {
  AutoContinueRunPayload,
  ContentReviewRunPayload,
  TextStylizeRunPayload,
} from "@/lib/workspace/workbenchCanvas";
import type { AutoContinueRequestPayload } from "@/lib/api/agentRuntime";
import { importDocument } from "@/lib/api/session-files";
import type { HandleSendOptions } from "../hooks/handleSendTypes";
import type { TopicBranchStatus } from "../hooks/useTopicBranchBoard";
import type { MessageImage } from "../types";
import {
  buildDefaultCanvasImageApplyTarget,
  buildDocumentImageWorkbenchPrompt,
  buildImageWorkbenchCommandText,
  buildPosterImageWorkbenchPrompt,
  resolveClosestImageAspectRatio,
  type ImageWorkbenchApplyTarget,
} from "./imageWorkbenchHelpers";
import {
  parseImageWorkbenchCommand,
  type ParsedImageWorkbenchCommand,
} from "../utils/imageWorkbenchCommand";

type WorkspaceSendHandler = (
  images?: MessageImage[],
  webSearch?: boolean,
  thinking?: boolean,
  textOverride?: string,
  sendExecutionStrategy?: "react" | "code_orchestrated" | "auto",
  autoContinuePayload?: AutoContinueRequestPayload,
  sendOptions?: HandleSendOptions,
) => Promise<boolean>;

interface ThinkingPreferenceState {
  thinking: boolean;
}

interface RunImageWorkbenchCommandParams {
  rawText: string;
  parsedCommand: ParsedImageWorkbenchCommand;
  images: MessageImage[];
  applyTarget?: ImageWorkbenchApplyTarget | null;
}

interface UseWorkspaceCanvasWorkflowActionsParams<
  TToolPreferences extends ThinkingPreferenceState,
> {
  setChatToolPreferences: Dispatch<SetStateAction<TToolPreferences>>;
  sendRef: MutableRefObject<WorkspaceSendHandler>;
  webSearchPreferenceRef: MutableRefObject<boolean>;
  setCanvasState: Dispatch<SetStateAction<CanvasStateUnion | null>>;
  setTopicStatus: (topicId: string, status: TopicBranchStatus) => void;
  projectId?: string | null;
  projectName?: string;
  canvasState: CanvasStateUnion | null;
  contentId?: string | null;
  onRunImageWorkbenchCommand: (
    params: RunImageWorkbenchCommandParams,
  ) => Promise<unknown>;
}

interface WorkspaceCanvasWorkflowActionsResult {
  handleDocumentThinkingEnabledChange: (enabled: boolean) => void;
  handleDocumentAutoContinueRun: (
    payload: AutoContinueRunPayload,
  ) => Promise<void>;
  handleDocumentContentReviewRun: (
    payload: ContentReviewRunPayload,
  ) => Promise<string>;
  handleDocumentTextStylizeRun: (
    payload: TextStylizeRunPayload,
  ) => Promise<string>;
  handleSwitchBranchVersion: (versionId: string) => void;
  handleCreateVersionSnapshot: () => void;
  handleSetBranchStatus: (
    topicId: string,
    status: TopicBranchStatus,
  ) => void;
  handleAddImage: () => Promise<void>;
  handleImportDocument: () => Promise<void>;
}

export function useWorkspaceCanvasWorkflowActions<
  TToolPreferences extends ThinkingPreferenceState,
>({
  setChatToolPreferences,
  sendRef,
  webSearchPreferenceRef,
  setCanvasState,
  setTopicStatus,
  projectId,
  projectName,
  canvasState,
  contentId,
  onRunImageWorkbenchCommand,
}: UseWorkspaceCanvasWorkflowActionsParams<TToolPreferences>): WorkspaceCanvasWorkflowActionsResult {
  const handleDocumentThinkingEnabledChange = useCallback(
    (enabled: boolean) => {
      setChatToolPreferences((previous) =>
        previous.thinking === enabled
          ? previous
          : {
              ...previous,
              thinking: enabled,
            },
      );
    },
    [setChatToolPreferences],
  );

  const handleDocumentAutoContinueRun = useCallback(
    async (payload: AutoContinueRunPayload) => {
      await sendRef.current(
        [],
        webSearchPreferenceRef.current,
        payload.thinkingEnabled,
        payload.prompt,
        undefined,
        {
          enabled: payload.settings.enabled,
          fast_mode_enabled: payload.settings.fastModeEnabled,
          continuation_length: payload.settings.continuationLength,
          sensitivity: payload.settings.sensitivity,
          source: "theme_workbench_document_auto_continue",
        },
      );
    },
    [sendRef, webSearchPreferenceRef],
  );

  const handleDocumentContentReviewRun = useCallback(
    async (payload: ContentReviewRunPayload) =>
      await new Promise<string>((resolve, reject) => {
        void sendRef
          .current(
            [],
            webSearchPreferenceRef.current,
            payload.thinkingEnabled,
            payload.prompt,
            undefined,
            undefined,
            {
              skipThemeSkillPrefix: true,
              purpose: "content_review",
              observer: {
                onComplete: resolve,
                onError: (message) => reject(new Error(message)),
              },
            },
          )
          .catch((error) => {
            reject(error instanceof Error ? error : new Error(String(error)));
          });
      }),
    [sendRef, webSearchPreferenceRef],
  );

  const handleDocumentTextStylizeRun = useCallback(
    async (payload: TextStylizeRunPayload) =>
      await new Promise<string>((resolve, reject) => {
        void sendRef
          .current(
            [],
            webSearchPreferenceRef.current,
            payload.thinkingEnabled,
            payload.prompt,
            undefined,
            undefined,
            {
              skipThemeSkillPrefix: true,
              purpose: "text_stylize",
              observer: {
                onComplete: resolve,
                onError: (message) => reject(new Error(message)),
              },
            },
          )
          .catch((error) => {
            reject(error instanceof Error ? error : new Error(String(error)));
          });
      }),
    [sendRef, webSearchPreferenceRef],
  );

  const handleSwitchBranchVersion = useCallback(
    (versionId: string) => {
      setCanvasState((previous) => {
        if (!previous || previous.type !== "document") {
          return previous;
        }

        const targetVersion = previous.versions.find(
          (version) => version.id === versionId,
        );
        if (!targetVersion) {
          return previous;
        }

        return {
          ...previous,
          currentVersionId: targetVersion.id,
          content: targetVersion.content,
        };
      });
    },
    [setCanvasState],
  );

  const handleCreateVersionSnapshot = useCallback(() => {
    setCanvasState((previous) => {
      if (!previous || previous.type !== "document") {
        toast.info("当前没有可管理的文稿版本");
        return previous;
      }

      const content = previous.content.trim();
      if (!content) {
        toast.info("主稿为空，无法创建版本快照");
        return previous;
      }

      const nextIndex = previous.versions.length + 1;
      const newVersion = {
        id: crypto.randomUUID(),
        content: previous.content,
        createdAt: Date.now(),
        description: `手动快照 - 版本 ${nextIndex}`,
      };

      toast.success("已创建版本快照");
      return {
        ...previous,
        versions: [...previous.versions, newVersion],
        currentVersionId: newVersion.id,
      };
    });
  }, [setCanvasState]);

  const handleSetBranchStatus = useCallback(
    (topicId: string, status: TopicBranchStatus) => {
      setTopicStatus(topicId, status);
      if (status === "merged") {
        toast.success("已将该版本标记为主稿");
      } else if (status === "pending") {
        toast.info("已将该版本标记为待评审");
      }
    },
    [setTopicStatus],
  );

  const handleAddImage = useCallback(async () => {
    if (!projectId) {
      toast.error("请先选择项目后再开始配图");
      return;
    }

    if (!canvasState) {
      toast.info("当前没有可用画布");
      return;
    }

    let rawText = "";
    let applyTarget: ImageWorkbenchApplyTarget | null = null;

    if (canvasState.type === "document") {
      rawText = buildImageWorkbenchCommandText(
        buildDocumentImageWorkbenchPrompt({
          projectName,
          platform: canvasState.platform,
          content: canvasState.content,
        }),
      );
      applyTarget = buildDefaultCanvasImageApplyTarget({
        canvasState,
        projectId,
        contentId: contentId ?? null,
      });
    } else if (canvasState.type === "poster") {
      const currentPage =
        canvasState.pages[canvasState.currentPageIndex] || canvasState.pages[0];
      if (!currentPage) {
        toast.error("海报画布缺少有效页面");
        return;
      }
      rawText = buildImageWorkbenchCommandText(
        buildPosterImageWorkbenchPrompt({
          projectName,
          width: currentPage.width,
          height: currentPage.height,
        }),
        {
          aspectRatio: resolveClosestImageAspectRatio(
            currentPage.width,
            currentPage.height,
          ),
        },
      );
      applyTarget = buildDefaultCanvasImageApplyTarget({
        canvasState,
        projectId,
        contentId: contentId ?? null,
      });
    } else {
      toast.info("当前画布暂未接入配图工作台");
      return;
    }

    const parsedCommand = parseImageWorkbenchCommand(rawText);
    if (!parsedCommand) {
      toast.error("配图任务初始化失败");
      return;
    }

    await onRunImageWorkbenchCommand({
      rawText,
      parsedCommand,
      images: [],
      applyTarget,
    });
  }, [
    canvasState,
    contentId,
    onRunImageWorkbenchCommand,
    projectId,
    projectName,
  ]);

  const handleImportDocument = useCallback(async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        filters: [
          {
            name: "文档",
            extensions: ["md", "txt"],
          },
        ],
      });

      if (!selected) {
        return;
      }

      const filePath = selected;
      if (!filePath) {
        toast.error("未选择文件");
        return;
      }

      toast.info("正在导入文稿...");

      const content = await importDocument(filePath);

      setCanvasState((previous) => {
        if (!previous || previous.type !== "document") {
          toast.error("当前不在文档编辑模式");
          return previous;
        }

        return {
          ...previous,
          content,
        };
      });

      toast.success("文稿已导入");
    } catch (error) {
      console.error("导入文稿失败:", error);
      toast.error(error instanceof Error ? error.message : "导入文稿失败");
    }
  }, [setCanvasState]);

  return {
    handleDocumentThinkingEnabledChange,
    handleDocumentAutoContinueRun,
    handleDocumentContentReviewRun,
    handleDocumentTextStylizeRun,
    handleSwitchBranchVersion,
    handleCreateVersionSnapshot,
    handleSetBranchStatus,
    handleAddImage,
    handleImportDocument,
  };
}
