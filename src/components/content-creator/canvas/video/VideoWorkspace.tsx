import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styled from "styled-components";
import { Video } from "lucide-react";
import { toast } from "sonner";
import { VideoCanvasState } from "./types";
import { PromptInput } from "./PromptInput";
import {
  importMaterialFromUrl,
  type ImportMaterialFromUrlRequest,
} from "@/lib/api/materials";
import {
  videoGenerationApi,
  type VideoGenerationTask,
} from "@/lib/api/videoGeneration";
import { skillsApi, type Skill } from "@/lib/api/skills";

interface VideoWorkspaceProps {
  state: VideoCanvasState;
  projectId?: string | null;
  onStateChange: (state: VideoCanvasState) => void;
}

const WorkspaceWrapper = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  height: 100%;
  width: 100%;
  padding: 28px 32px 24px;
`;

const ContentWrapper = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  max-width: 920px;
  gap: 32px;
`;

const EmptyStateWrapper = styled.div`
  width: 100%;
  max-width: 920px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 28px;
  margin-top: clamp(80px, 16vh, 180px);
`;

const HeaderIcons = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
`;

const IconBox = styled.div`
  width: 54px;
  height: 54px;
  background: hsl(var(--foreground));
  color: hsl(var(--background));
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const Title = styled.h1`
  font-size: 48px;
  line-height: 1;
  font-weight: 700;
  color: hsl(var(--foreground));
  margin: 0;
`;

const VideoPlayerPlaceholder = styled.div`
  width: 100%;
  aspect-ratio: 16/9;
  background: hsl(var(--muted) / 0.3);
  border-radius: 12px;
  border: 1px solid hsl(var(--border));
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
`;

const TaskList = styled.div`
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const TaskCard = styled.div`
  border: 1px solid hsl(var(--border));
  border-radius: 10px;
  background: hsl(var(--background));
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const StatusBadge = styled.span<{ $status: string }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 22px;
  border-radius: 999px;
  padding: 0 10px;
  font-size: 11px;
  background: ${({ $status }) =>
    $status === "success"
      ? "hsl(142 71% 45% / 0.12)"
      : $status === "error"
        ? "hsl(0 84% 60% / 0.12)"
        : "hsl(var(--primary) / 0.12)"};
  color: ${({ $status }) =>
    $status === "success"
      ? "hsl(142 71% 35%)"
      : $status === "error"
        ? "hsl(0 84% 45%)"
        : "hsl(var(--primary))"};
`;

const TaskMeta = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
`;

const TaskPrompt = styled.div`
  font-size: 13px;
  color: hsl(var(--foreground));
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
`;

interface WorkspaceTask extends VideoGenerationTask {
  resourceMaterialId?: string;
  resourceSavedAt?: number;
  resourceSaveError?: string;
}

const VIDEO_TASK_TAG = "video-gen";
const VIDEO_REFERENCE_TAG = "video-reference";

function isDirectRemoteUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

function isMaterialReferenceUrl(url: string): boolean {
  return url.startsWith("material://");
}

function buildVideoMaterialName(task: WorkspaceTask): string {
  const promptHead = task.prompt.trim().slice(0, 24) || "生成视频";
  const date = new Date(task.createdAt);
  const stamp = [
    date.getFullYear(),
    `${date.getMonth() + 1}`.padStart(2, "0"),
    `${date.getDate()}`.padStart(2, "0"),
    "-",
    `${date.getHours()}`.padStart(2, "0"),
    `${date.getMinutes()}`.padStart(2, "0"),
    `${date.getSeconds()}`.padStart(2, "0"),
  ].join("");
  return `${promptHead}-${stamp}.mp4`;
}

function formatTaskTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getHours().toString().padStart(2, "0")}:${date
    .getMinutes()
    .toString()
    .padStart(2, "0")}:${date.getSeconds().toString().padStart(2, "0")}`;
}

function mergeTaskList(
  previous: WorkspaceTask[],
  updates: WorkspaceTask[],
): WorkspaceTask[] {
  const updateMap = new Map(updates.map((task) => [task.id, task]));
  const merged = previous.map((task) => {
    const updated = updateMap.get(task.id);
    if (!updated) {
      return task;
    }
    return {
      ...task,
      ...updated,
      resourceMaterialId: task.resourceMaterialId ?? updated.resourceMaterialId,
      resourceSavedAt: task.resourceSavedAt ?? updated.resourceSavedAt,
      resourceSaveError: updated.resourceSaveError ?? task.resourceSaveError,
    };
  });

  for (const task of updates) {
    if (!merged.some((item) => item.id === task.id)) {
      merged.push(task);
    }
  }

  merged.sort((left, right) => right.createdAt - left.createdAt);
  return merged;
}

export const VideoWorkspace: React.FC<VideoWorkspaceProps> = memo(
  ({ state, projectId, onStateChange }) => {
    const [tasks, setTasks] = useState<WorkspaceTask[]>([]);
    const [skills, setSkills] = useState<Skill[]>([]);
    const pollingGuard = useRef(false);
    const savingTaskIdsRef = useRef<Set<string>>(new Set());
    const materialRefCache = useRef<Map<string, string>>(new Map());

    // 加载技能列表
    useEffect(() => {
      skillsApi
        .getAll("proxycast")
        .then(setSkills)
        .catch((err) => console.error("加载技能列表失败:", err));
    }, []);

    useEffect(() => {
      materialRefCache.current.clear();
    }, [projectId]);

    const syncPrimaryState = useCallback(
      (taskList: WorkspaceTask[]) => {
        if (taskList.length === 0) {
          return;
        }
        const latestTask = taskList[0];
        if (latestTask.status === "success" && latestTask.resultUrl) {
          if (
            state.status !== "success" ||
            state.videoUrl !== latestTask.resultUrl
          ) {
            onStateChange({
              ...state,
              status: "success",
              videoUrl: latestTask.resultUrl,
              errorMessage: undefined,
            });
          }
          return;
        }
        if (latestTask.status === "error") {
          const message = latestTask.errorMessage ?? "视频生成失败";
          if (state.status !== "error" || state.errorMessage !== message) {
            onStateChange({
              ...state,
              status: "error",
              errorMessage: message,
            });
          }
          return;
        }
        if (
          latestTask.status === "pending" ||
          latestTask.status === "processing"
        ) {
          if (state.status !== "generating") {
            onStateChange({
              ...state,
              status: "generating",
              errorMessage: undefined,
            });
          }
        }
      },
      [onStateChange, state],
    );

    const saveVideoToResource = useCallback(
      async (task: WorkspaceTask): Promise<void> => {
        if (!projectId || !task.resultUrl || task.resourceMaterialId) {
          return;
        }
        if (savingTaskIdsRef.current.has(task.id)) {
          return;
        }

        savingTaskIdsRef.current.add(task.id);
        try {
          const request: ImportMaterialFromUrlRequest = {
            projectId,
            name: buildVideoMaterialName(task),
            type: "video",
            url: task.resultUrl,
            tags: [VIDEO_TASK_TAG],
            description: `视频生成自动入库（服务：${task.providerId}，模型：${task.model}）`,
          };
          const savedMaterial = await importMaterialFromUrl(request);

          setTasks((previous) =>
            previous.map((item) =>
              item.id === task.id
                ? {
                    ...item,
                    resourceMaterialId: savedMaterial.id,
                    resourceSavedAt: Date.now(),
                    resourceSaveError: undefined,
                  }
                : item,
            ),
          );
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          setTasks((previous) =>
            previous.map((item) =>
              item.id === task.id
                ? { ...item, resourceSaveError: errorMessage }
                : item,
            ),
          );
        } finally {
          savingTaskIdsRef.current.delete(task.id);
        }
      },
      [projectId],
    );

    useEffect(() => {
      if (!projectId) {
        setTasks([]);
        return;
      }

      let active = true;
      const loadTasks = async () => {
        try {
          const list = await videoGenerationApi.listTasks(projectId, {
            limit: 50,
          });
          if (!active) {
            return;
          }
          const mapped = list.map((task) => ({ ...task }));
          setTasks(mapped);
          syncPrimaryState(mapped);
        } catch (error) {
          console.error("[VideoWorkspace] 加载视频任务失败:", error);
        }
      };

      void loadTasks();
      return () => {
        active = false;
      };
    }, [projectId, syncPrimaryState]);

    const runningTaskIds = useMemo(
      () =>
        tasks
          .filter(
            (task) => task.status === "pending" || task.status === "processing",
          )
          .map((task) => task.id),
      [tasks],
    );

    useEffect(() => {
      if (runningTaskIds.length === 0) {
        return;
      }
      let active = true;

      const tick = async () => {
        if (!active || pollingGuard.current) {
          return;
        }
        pollingGuard.current = true;
        try {
          const updates = await Promise.all(
            runningTaskIds.map((taskId) =>
              videoGenerationApi.getTask(taskId, { refreshStatus: true }),
            ),
          );

          if (!active) {
            return;
          }

          const normalizedUpdates = updates.filter(
            (task): task is WorkspaceTask => task !== null,
          );
          if (normalizedUpdates.length === 0) {
            return;
          }

          setTasks((previous) => {
            const merged = mergeTaskList(previous, normalizedUpdates);
            syncPrimaryState(merged);
            return merged;
          });

          for (const task of normalizedUpdates) {
            if (task.status === "success" && task.resultUrl) {
              void saveVideoToResource(task);
            }
          }
        } finally {
          pollingGuard.current = false;
        }
      };

      void tick();
      const timer = window.setInterval(() => {
        void tick();
      }, 3000);

      return () => {
        active = false;
        window.clearInterval(timer);
      };
    }, [runningTaskIds, saveVideoToResource, syncPrimaryState]);

    const ensureReferenceImageUrl = useCallback(
      async (
        imageUrl: string | undefined,
        frameType: "start" | "end",
      ): Promise<string | undefined> => {
        const normalizedUrl = imageUrl?.trim();
        if (!normalizedUrl) {
          return undefined;
        }
        if (
          isDirectRemoteUrl(normalizedUrl) ||
          isMaterialReferenceUrl(normalizedUrl)
        ) {
          return normalizedUrl;
        }
        if (!normalizedUrl.startsWith("data:")) {
          throw new Error("参考图格式不支持，请重新上传图片");
        }

        const cached = materialRefCache.current.get(normalizedUrl);
        if (cached) {
          return cached;
        }

        if (!projectId) {
          throw new Error("未选择项目，无法处理参考图");
        }

        const request: ImportMaterialFromUrlRequest = {
          projectId,
          name: frameType === "start" ? "视频首帧参考图" : "视频尾帧参考图",
          type: "image",
          url: normalizedUrl,
          tags: [VIDEO_REFERENCE_TAG, frameType],
          description:
            frameType === "start"
              ? "视频生成首帧参考图（自动上传）"
              : "视频生成尾帧参考图（自动上传）",
        };
        const material = await importMaterialFromUrl(request);

        const materialUrl = `material://${material.id}`;
        materialRefCache.current.set(normalizedUrl, materialUrl);
        return materialUrl;
      },
      [projectId],
    );

    const handleGenerate = useCallback(
      async (textOverride?: string) => {
        if (!projectId) {
          toast.error("请先选择项目后再生成视频");
          return;
        }
        if (!state.providerId) {
          toast.error("请选择视频服务");
          return;
        }
        if (!state.model) {
          toast.error("请选择视频模型");
          return;
        }
        const promptText = textOverride || state.prompt.trim();
        if (!promptText) {
          toast.error("请输入视频描述");
          return;
        }
        const providerNormalized = state.providerId.trim().toLowerCase();
        const supportedProvider =
          providerNormalized.includes("doubao") ||
          providerNormalized.includes("volc") ||
          providerNormalized.includes("dashscope") ||
          providerNormalized.includes("alibaba") ||
          providerNormalized.includes("qwen");
        if (!supportedProvider) {
          toast.error("当前仅支持火山或阿里兼容视频服务");
          return;
        }

        onStateChange({
          ...state,
          status: "generating",
          errorMessage: undefined,
        });
        try {
          const [resolvedStartImageUrl, resolvedEndImageUrl] =
            await Promise.all([
              ensureReferenceImageUrl(state.startImage, "start"),
              ensureReferenceImageUrl(state.endImage, "end"),
            ]);

          const created = await videoGenerationApi.createTask({
            projectId,
            providerId: state.providerId,
            model: state.model,
            prompt: promptText,
            aspectRatio: state.aspectRatio,
            resolution: state.resolution,
            duration: state.duration,
            imageUrl: resolvedStartImageUrl,
            endImageUrl: resolvedEndImageUrl,
            seed: state.seed,
            generateAudio: state.generateAudio,
            cameraFixed: state.cameraFixed,
          });

          setTasks((previous) => {
            const merged = mergeTaskList(previous, [created]);
            return merged;
          });
          toast.success("视频任务已提交，正在生成");
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          onStateChange({
            ...state,
            status: "error",
            errorMessage: message,
          });
          toast.error(message);
        }
      },
      [ensureReferenceImageUrl, onStateChange, projectId, state],
    );

    const isGenerated = tasks.length > 0 || state.status !== "idle";

    return (
      <WorkspaceWrapper>
        {!isGenerated ? (
          <EmptyStateWrapper>
            <HeaderIcons>
              <IconBox>
                <Video size={28} />
              </IconBox>
              <Title>视频</Title>
            </HeaderIcons>
            <PromptInput
              state={state}
              onStateChange={onStateChange}
              onGenerate={handleGenerate}
              skills={skills}
            />
          </EmptyStateWrapper>
        ) : (
          <ContentWrapper
            style={{ height: "100%", justifyContent: "flex-start" }}
          >
            <VideoPlayerPlaceholder>
              {state.status === "generating" ? (
                <span>正在生成视频中...</span>
              ) : state.status === "error" ? (
                <span>{state.errorMessage ?? "视频生成失败"}</span>
              ) : state.videoUrl ? (
                <video
                  controls
                  src={state.videoUrl}
                  style={{ width: "100%", height: "100%", borderRadius: 12 }}
                />
              ) : (
                <span>等待视频生成结果...</span>
              )}
            </VideoPlayerPlaceholder>

            <TaskList>
              {tasks.map((task) => (
                <TaskCard key={task.id}>
                  <TaskMeta>
                    <StatusBadge $status={task.status}>
                      {task.status === "success"
                        ? "已完成"
                        : task.status === "error"
                          ? "失败"
                          : task.status === "cancelled"
                            ? "已取消"
                            : "生成中"}
                    </StatusBadge>
                    <span>{formatTaskTime(task.createdAt)}</span>
                  </TaskMeta>
                  <TaskPrompt>{task.prompt}</TaskPrompt>
                  <TaskMeta>
                    <span>
                      {task.providerId} · {task.model}
                    </span>
                    <span>
                      {task.progress !== undefined && task.progress !== null
                        ? `${task.progress}%`
                        : "--"}
                    </span>
                  </TaskMeta>
                  {task.errorMessage ? (
                    <div style={{ fontSize: 12, color: "hsl(0 84% 45%)" }}>
                      {task.errorMessage}
                    </div>
                  ) : null}
                </TaskCard>
              ))}
            </TaskList>

            <PromptInput
              state={state}
              onStateChange={onStateChange}
              onGenerate={handleGenerate}
              skills={skills}
            />
          </ContentWrapper>
        )}
      </WorkspaceWrapper>
    );
  },
);

VideoWorkspace.displayName = "VideoWorkspace";
