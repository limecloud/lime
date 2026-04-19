import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styled from "styled-components";
import { ArrowUpRight, Sparkles, Video } from "lucide-react";
import { toast } from "sonner";
import { VideoCanvasState } from "./types";
import { PromptInput } from "./PromptInput";
import {
  importMaterialFromUrl,
  type ImportMaterialFromUrlRequest,
} from "@/lib/api/materials";
import { WorkbenchInfoTip } from "@/components/media/WorkbenchInfoTip";
import {
  videoGenerationApi,
  type VideoGenerationTask,
} from "@/lib/api/videoGeneration";

interface VideoWorkspaceProps {
  state: VideoCanvasState;
  projectId?: string | null;
  onStateChange: (state: VideoCanvasState) => void;
}

const WorkspaceWrapper = styled.div`
  position: relative;
  height: 100%;
  width: 100%;
  overflow: auto;
  padding: 28px 28px 32px;

  @media (max-width: 1100px) {
    padding: 20px 18px 24px;
  }
`;

const PageShell = styled.div`
  width: 100%;
  max-width: 1280px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
`;

const SurfaceCard = styled.section`
  position: relative;
  overflow: hidden;
  border-radius: 32px;
  border: 1px solid hsl(var(--border) / 0.78);
  background: linear-gradient(
    180deg,
    hsl(var(--background) / 0.96),
    hsl(201 46% 98% / 0.96)
  );
  box-shadow:
    0 22px 54px hsl(215 30% 14% / 0.08),
    inset 0 1px 0 hsl(0 0% 100% / 0.74);

  &::before {
    content: "";
    position: absolute;
    inset: auto auto -120px -80px;
    width: 260px;
    height: 260px;
    border-radius: 999px;
    background: hsl(154 62% 84% / 0.18);
    filter: blur(56px);
    pointer-events: none;
  }

  &::after {
    content: "";
    position: absolute;
    inset: -120px -80px auto auto;
    width: 240px;
    height: 240px;
    border-radius: 999px;
    background: hsl(203 88% 84% / 0.18);
    filter: blur(56px);
    pointer-events: none;
  }
`;

const HeroPanel = styled(SurfaceCard)`
  padding: 26px;

  @media (max-width: 1100px) {
    padding: 20px;
  }
`;

const HeroHeader = styled.div`
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;

  @media (max-width: 1100px) {
    flex-direction: column;
  }
`;

const HeroCopy = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 680px;
`;

const Eyebrow = styled.span`
  display: inline-flex;
  align-items: center;
  width: fit-content;
  border-radius: 999px;
  border: 1px solid hsl(203 82% 88%);
  background: hsl(200 100% 97%);
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: hsl(211 58% 38%);
`;

const HeroTitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
`;

const IconBox = styled.div`
  width: 58px;
  height: 58px;
  border-radius: 20px;
  background: linear-gradient(180deg, hsl(221 39% 16%), hsl(216 34% 12%));
  color: hsl(var(--background));
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 18px 36px hsl(220 40% 12% / 0.18);
`;

const HeroTitle = styled.h1`
  margin: 0;
  font-size: clamp(34px, 4vw, 48px);
  line-height: 1.04;
  font-weight: 700;
  color: hsl(var(--foreground));
`;

const StatsGrid = styled.div`
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  min-width: min(360px, 100%);

  @media (max-width: 1100px) {
    width: 100%;
  }

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
    min-width: 0;
  }
`;

const StatCard = styled.div`
  border-radius: 22px;
  border: 1px solid hsl(var(--border) / 0.82);
  background: hsl(var(--background) / 0.88);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const StatHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

const StatLabel = styled.span`
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: hsl(var(--muted-foreground));
`;

const StatValue = styled.span`
  font-size: 16px;
  line-height: 1.4;
  font-weight: 700;
  color: hsl(var(--foreground));
  word-break: break-word;
`;

const PromptBlock = styled.div`
  position: relative;
  z-index: 1;
  margin-top: 22px;
`;

const WorkspaceHeaderCard = styled(SurfaceCard)`
  padding: 22px;

  @media (max-width: 1100px) {
    padding: 18px;
  }
`;

const WorkspaceHeaderTop = styled.div`
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 18px;

  @media (max-width: 960px) {
    flex-direction: column;
  }
`;

const WorkspaceHeaderCopy = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 760px;
`;

const WorkspaceTitle = styled.h2`
  margin: 0;
  font-size: 30px;
  line-height: 1.12;
  font-weight: 700;
  color: hsl(var(--foreground));
`;

const WorkspaceTitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
`;

const HeaderBadgeRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
`;

const StatusBadge = styled.span<{
  $tone: "neutral" | "processing" | "success" | "error" | "cancelled";
}>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  border-radius: 999px;
  padding: 0 12px;
  border: 1px solid
    ${({ $tone }) =>
      $tone === "success"
        ? "hsl(152 52% 82%)"
        : $tone === "error"
          ? "hsl(0 84% 87%)"
          : $tone === "processing"
            ? "hsl(203 86% 84%)"
            : $tone === "cancelled"
              ? "hsl(215 20% 85%)"
              : "hsl(var(--border) / 0.88)"};
  background: ${({ $tone }) =>
    $tone === "success"
      ? "hsl(152 62% 95%)"
      : $tone === "error"
        ? "hsl(0 100% 97%)"
        : $tone === "processing"
          ? "hsl(203 100% 97%)"
          : $tone === "cancelled"
            ? "hsl(215 25% 95%)"
            : "hsl(var(--background))"};
  color: ${({ $tone }) =>
    $tone === "success"
      ? "hsl(152 56% 26%)"
      : $tone === "error"
        ? "hsl(0 72% 38%)"
        : $tone === "processing"
          ? "hsl(211 58% 38%)"
          : $tone === "cancelled"
            ? "hsl(215 16% 42%)"
            : "hsl(var(--muted-foreground))"};
  font-size: 12px;
  font-weight: 700;
`;

const HeaderChip = styled.span`
  display: inline-flex;
  align-items: center;
  height: 32px;
  border-radius: 999px;
  border: 1px solid hsl(var(--border) / 0.88);
  background: hsl(var(--background) / 0.84);
  padding: 0 12px;
  font-size: 12px;
  font-weight: 600;
  color: hsl(var(--muted-foreground));
`;

const ResultGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(320px, 0.95fr);
  gap: 18px;

  @media (max-width: 1100px) {
    grid-template-columns: 1fr;
  }
`;

const ResultPanel = styled(SurfaceCard)`
  padding: 18px;
`;

const ResultPanelHeader = styled.div`
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;

  @media (max-width: 720px) {
    flex-direction: column;
  }
`;

const ResultPanelCopy = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const ResultPanelTitle = styled.h3`
  margin: 0;
  font-size: 20px;
  line-height: 1.2;
  font-weight: 700;
  color: hsl(var(--foreground));
`;

const ResultPanelTitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
`;

const ResultPanelDescription = styled.p`
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: hsl(var(--muted-foreground));
`;

const StageFrame = styled.div`
  position: relative;
  z-index: 1;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 28px;
  border: 1px solid hsl(var(--border) / 0.8);
  background:
    radial-gradient(circle at top, hsl(202 100% 97%), transparent 34%),
    linear-gradient(180deg, hsl(214 52% 11%), hsl(219 44% 9%));
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: inset 0 1px 0 hsl(0 0% 100% / 0.08);
`;

const StageVideo = styled.video`
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
`;

const StagePlaceholder = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 24px;
  text-align: center;
  color: hsl(210 40% 96%);
`;

const StagePlaceholderIcon = styled.div`
  width: 68px;
  height: 68px;
  border-radius: 22px;
  background: hsl(0 0% 100% / 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
`;

const StagePlaceholderTitle = styled.div`
  font-size: 22px;
  line-height: 1.25;
  font-weight: 700;
`;

const StagePlaceholderDescription = styled.p`
  margin: 0;
  max-width: 460px;
  font-size: 14px;
  line-height: 1.7;
  color: hsl(212 32% 78%);
`;

const StageFooter = styled.div`
  position: relative;
  z-index: 1;
  margin-top: 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
`;

const StageFooterTips = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const FocusedTaskPanel = styled.div`
  position: relative;
  z-index: 1;
  margin-top: 14px;
  border-radius: 24px;
  border: 1px solid hsl(var(--border) / 0.84);
  background: hsl(var(--background) / 0.94);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

const FocusedTaskHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
`;

const FocusedTaskCopy = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const FocusedTaskTitle = styled.h4`
  margin: 0;
  font-size: 15px;
  line-height: 1.4;
  font-weight: 700;
  color: hsl(var(--foreground));
`;

const FocusedTaskDescription = styled.p`
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: hsl(var(--muted-foreground));
`;

const FocusedTaskPrompt = styled.div`
  border-radius: 18px;
  border: 1px solid hsl(var(--border) / 0.82);
  background: hsl(var(--muted) / 0.12);
  padding: 14px 16px;
  font-size: 14px;
  line-height: 1.7;
  color: hsl(var(--foreground));
  white-space: pre-wrap;
  word-break: break-word;
`;

const FocusedTaskMetaGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
`;

const FocusedTaskMetaCard = styled.div`
  border-radius: 18px;
  border: 1px solid hsl(var(--border) / 0.84);
  background: hsl(var(--background));
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const FocusedTaskMetaLabel = styled.span`
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: hsl(var(--muted-foreground));
`;

const FocusedTaskMetaValue = styled.span`
  font-size: 14px;
  line-height: 1.6;
  font-weight: 700;
  color: hsl(var(--foreground));
  word-break: break-word;
`;

const FocusedTaskMetaHint = styled.span`
  font-size: 12px;
  line-height: 1.6;
  color: hsl(var(--muted-foreground));
  word-break: break-word;
`;

const TaskCounter = styled.span`
  display: inline-flex;
  align-items: center;
  height: 30px;
  border-radius: 999px;
  padding: 0 12px;
  background: hsl(var(--muted) / 0.18);
  color: hsl(var(--foreground));
  font-size: 12px;
  font-weight: 700;
`;

const TaskList = styled.div`
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const TaskCard = styled.article<{ $active?: boolean }>`
  border-radius: 24px;
  border: 1px solid
    ${(props) =>
      props.$active ? "hsl(214 68% 38% / 0.34)" : "hsl(var(--border) / 0.84)"};
  background: ${(props) =>
    props.$active ? "hsl(203 100% 97%)" : "hsl(var(--background) / 0.92)"};
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: ${(props) =>
    props.$active ? "0 14px 32px hsl(204 68% 46% / 0.1)" : "none"};
`;

const TaskTopRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
`;

const TaskMetaRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
`;

const TaskPrompt = styled.div`
  font-size: 14px;
  color: hsl(var(--foreground));
  line-height: 1.65;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
`;

const TaskProgressTrack = styled.div`
  width: 100%;
  height: 6px;
  border-radius: 999px;
  background: hsl(var(--muted) / 0.35);
  overflow: hidden;
`;

const TaskProgressBar = styled.div<{ $progress: number }>`
  width: ${({ $progress }) => `${$progress}%`};
  height: 100%;
  background: linear-gradient(90deg, hsl(211 58% 48%), hsl(195 72% 48%));
  border-radius: 999px;
`;

const TaskAssistText = styled.p<{ $tone?: "default" | "success" | "error" }>`
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: ${({ $tone }) =>
    $tone === "success"
      ? "hsl(152 56% 26%)"
      : $tone === "error"
        ? "hsl(0 72% 38%)"
        : "hsl(var(--muted-foreground))"};
`;

const TaskBottomRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
`;

const TaskActionButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  border-radius: 999px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  padding: 0 12px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition:
    transform 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease;

  &:hover {
    transform: translateY(-1px);
    border-color: hsl(214 68% 38% / 0.34);
    box-shadow: 0 12px 24px hsl(215 30% 14% / 0.08);
  }
`;

const EmptyTasks = styled.div`
  position: relative;
  z-index: 1;
  border-radius: 24px;
  border: 1px dashed hsl(var(--border));
  background: hsl(var(--muted) / 0.12);
  padding: 28px 18px;
  text-align: center;
  font-size: 13px;
  line-height: 1.7;
  color: hsl(var(--muted-foreground));
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
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
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

function resolveFocusedTask(
  taskList: WorkspaceTask[],
  selectedTaskId?: string,
): WorkspaceTask | null {
  const normalizedSelectedTaskId = selectedTaskId?.trim();
  if (normalizedSelectedTaskId) {
    const matchedTask = taskList.find(
      (task) => task.id === normalizedSelectedTaskId,
    );
    if (matchedTask) {
      return matchedTask;
    }
  }
  return taskList[0] ?? null;
}

function getStatusTone(
  status: string,
): "neutral" | "processing" | "success" | "error" | "cancelled" {
  if (status === "success") {
    return "success";
  }
  if (status === "error") {
    return "error";
  }
  if (status === "cancelled") {
    return "cancelled";
  }
  if (
    status === "pending" ||
    status === "processing" ||
    status === "generating"
  ) {
    return "processing";
  }
  return "neutral";
}

function getTaskStatusLabel(status: string): string {
  if (status === "success") {
    return "已完成";
  }
  if (status === "error") {
    return "失败";
  }
  if (status === "cancelled") {
    return "已取消";
  }
  if (status === "pending") {
    return "排队中";
  }
  return "生成中";
}

function clampProgress(value?: number | null): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function parseTaskRequestPayload(
  task: WorkspaceTask,
): Record<string, unknown> | null {
  const normalizedPayload = task.requestPayload?.trim();
  if (!normalizedPayload) {
    return null;
  }

  try {
    const parsed = JSON.parse(normalizedPayload) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readTaskPayloadString(
  payload: Record<string, unknown> | null,
  keys: string[],
): string | null {
  if (!payload) {
    return null;
  }

  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function readTaskPayloadPositiveNumber(
  payload: Record<string, unknown> | null,
  keys: string[],
): number | null {
  if (!payload) {
    return null;
  }

  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }

  return null;
}

function resolveTaskSyncCopy(task: WorkspaceTask): {
  label: string;
  hint: string;
} {
  const progress = clampProgress(task.progress);

  if (task.status === "success") {
    if (task.resourceMaterialId) {
      return {
        label: "已同步到项目素材",
        hint: "当前结果已经沉淀到项目素材库，可继续复用或组合后续命令。",
      };
    }
    if (task.resourceSaveError) {
      return {
        label: "素材同步失败",
        hint: task.resourceSaveError,
      };
    }
    return {
      label: "结果已生成",
      hint: "视频已经可预览，素材入库会继续在后台自动完成。",
    };
  }

  if (task.status === "error") {
    return {
      label: "生成失败",
      hint: task.errorMessage?.trim() || "请检查提示词、模型配置或参考图。",
    };
  }

  if (task.status === "cancelled") {
    return {
      label: "任务已取消",
      hint: "当前任务不会继续生成新的结果，可直接重新发起下一轮。",
    };
  }

  if (typeof progress === "number") {
    return {
      label: `当前进度 ${progress}%`,
      hint: "工作台会继续刷新状态，完成后自动切换为可预览结果。",
    };
  }

  if (task.status === "pending") {
    return {
      label: "排队中",
      hint: "任务已提交到生成队列，等待服务端返回正式进度。",
    };
  }

  return {
    label: "生成中",
    hint: "视频任务正在执行，当前会优先展示你选中的任务状态。",
  };
}

export const VideoWorkspace: React.FC<VideoWorkspaceProps> = memo(
  ({ state, projectId, onStateChange }) => {
    const [tasks, setTasks] = useState<WorkspaceTask[]>([]);
    const pollingGuard = useRef(false);
    const savingTaskIdsRef = useRef<Set<string>>(new Set());
    const materialRefCache = useRef<Map<string, string>>(new Map());
    const stateRef = useRef(state);

    useEffect(() => {
      stateRef.current = state;
    }, [state]);

    const pushState = useCallback(
      (nextState: VideoCanvasState) => {
        stateRef.current = nextState;
        onStateChange(nextState);
      },
      [onStateChange],
    );

    useEffect(() => {
      materialRefCache.current.clear();
    }, [projectId]);

    const syncPrimaryState = useCallback(
      (taskList: WorkspaceTask[]) => {
        const currentState = stateRef.current;
        const focusedTask = resolveFocusedTask(
          taskList,
          currentState.selectedTaskId,
        );
        if (!focusedTask) {
          return;
        }
        const baseState =
          currentState.selectedTaskId === focusedTask.id
            ? currentState
            : {
                ...currentState,
                selectedTaskId: focusedTask.id,
              };

        if (focusedTask.status === "success" && focusedTask.resultUrl) {
          if (
            baseState.status !== "success" ||
            baseState.videoUrl !== focusedTask.resultUrl ||
            baseState.errorMessage !== undefined
          ) {
            pushState({
              ...baseState,
              status: "success",
              videoUrl: focusedTask.resultUrl,
              errorMessage: undefined,
            });
          } else if (baseState !== currentState) {
            pushState(baseState);
          }
          return;
        }
        if (
          focusedTask.status === "error" ||
          focusedTask.status === "cancelled"
        ) {
          const message =
            focusedTask.errorMessage ??
            (focusedTask.status === "cancelled"
              ? "视频任务已取消"
              : "视频生成失败");
          if (
            baseState.status !== "error" ||
            baseState.errorMessage !== message
          ) {
            pushState({
              ...baseState,
              status: "error",
              errorMessage: message,
            });
          } else if (baseState !== currentState) {
            pushState(baseState);
          }
          return;
        }
        if (
          focusedTask.status === "pending" ||
          focusedTask.status === "processing"
        ) {
          if (
            baseState.status !== "generating" ||
            baseState.errorMessage !== undefined
          ) {
            pushState({
              ...baseState,
              status: "generating",
              errorMessage: undefined,
            });
          } else if (baseState !== currentState) {
            pushState(baseState);
          }
        }
      },
      [pushState],
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
          const mapped = mergeTaskList(
            [],
            list.map((task) => ({ ...task })),
          );
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

        pushState({
          ...stateRef.current,
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

          pushState({
            ...stateRef.current,
            status: "generating",
            selectedTaskId: created.id,
            errorMessage: undefined,
          });
          setTasks((previous) => {
            const merged = mergeTaskList(previous, [created]);
            syncPrimaryState(merged);
            return merged;
          });
          toast.success("视频任务已提交，正在生成");
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          pushState({
            ...stateRef.current,
            status: "error",
            errorMessage: message,
          });
          toast.error(message);
        }
      },
      [ensureReferenceImageUrl, projectId, pushState, state, syncPrimaryState],
    );

    const handlePreviewTask = useCallback(
      (task: WorkspaceTask) => {
        if (!task.resultUrl) {
          return;
        }
        pushState({
          ...stateRef.current,
          selectedTaskId: task.id,
          status: "success",
          videoUrl: task.resultUrl,
          errorMessage: undefined,
        });
      },
      [pushState],
    );

    const isGenerated = tasks.length > 0 || state.status !== "idle";
    const latestTask = tasks[0] ?? null;
    const focusedTask = useMemo(
      () => resolveFocusedTask(tasks, state.selectedTaskId),
      [state.selectedTaskId, tasks],
    );
    const activeTaskId = focusedTask?.id ?? state.selectedTaskId ?? null;
    const referenceCount = [state.startImage, state.endImage].filter(
      Boolean,
    ).length;

    const summaryCards = useMemo(
      () => [
        {
          label: "当前模型",
          value: state.model || "待选择",
          hint: state.providerId || "请先在左侧选择视频服务",
        },
        {
          label: "输出规格",
          value: `${state.aspectRatio} · ${state.resolution}`,
          hint: `时长 ${state.duration} 秒`,
        },
        {
          label: "参考图",
          value:
            referenceCount > 0 ? `${referenceCount} 张参考图` : "纯文生视频",
          hint:
            referenceCount > 0
              ? "可用于锁定开场、结尾或主体一致性"
              : "先验证镜头，再逐步加入约束",
        },
        {
          label: "任务同步",
          value: projectId ? "结果自动入库" : "需先选择项目",
          hint: projectId ? "成功后会沉淀到项目素材" : "当前无法提交视频任务",
        },
      ],
      [
        projectId,
        referenceCount,
        state.aspectRatio,
        state.duration,
        state.model,
        state.providerId,
        state.resolution,
      ],
    );

    const workspaceStatus = useMemo(() => {
      if (state.status === "generating") {
        return {
          label: "生成中",
          tone: "processing" as const,
          detail:
            focusedTask?.progress != null
              ? `当前进度 ${Math.round(focusedTask.progress)}%`
              : "任务已提交，正在持续刷新当前进度。",
        };
      }
      if (state.status === "success" && state.videoUrl) {
        return {
          label: "已生成",
          tone: "success" as const,
          detail:
            focusedTask && latestTask && focusedTask.id !== latestTask.id
              ? "当前正在查看一条历史结果，可在右侧继续切换不同任务做比较。"
              : "当前结果已就绪，可继续调整提示词并发起下一轮生成。",
        };
      }
      if (state.status === "error") {
        return {
          label: "生成失败",
          tone: "error" as const,
          detail: state.errorMessage ?? "请检查提示词、模型配置或参考图。",
        };
      }
      return {
        label: "待开始",
        tone: "neutral" as const,
        detail: "先在提示框描述画面，再提交一次生成任务。",
      };
    }, [
      focusedTask,
      latestTask,
      state.errorMessage,
      state.status,
      state.videoUrl,
    ]);

    const focusedTaskSummary = useMemo(() => {
      if (!focusedTask) {
        return null;
      }

      const payload = parseTaskRequestPayload(focusedTask);
      const providerLabel =
        focusedTask.providerId?.trim() ||
        readTaskPayloadString(payload, ["providerId", "provider_id"]) ||
        state.providerId ||
        "待选择服务";
      const modelLabel =
        focusedTask.model?.trim() ||
        readTaskPayloadString(payload, ["model"]) ||
        state.model ||
        "待选择模型";
      const aspectRatioLabel =
        readTaskPayloadString(payload, ["aspectRatio", "aspect_ratio"]) ||
        state.aspectRatio;
      const resolutionLabel =
        readTaskPayloadString(payload, ["resolution"]) || state.resolution;
      const durationLabel =
        readTaskPayloadPositiveNumber(payload, ["duration"]) || state.duration;
      const promptLabel = focusedTask.prompt?.trim() || state.prompt.trim();
      const syncCopy = resolveTaskSyncCopy(focusedTask);
      const isLatestFocused = latestTask?.id === focusedTask.id;

      return {
        prompt: promptLabel || "当前任务没有返回明确提示词。",
        sourceValue: `${providerLabel} · ${modelLabel}`,
        sourceHint: isLatestFocused
          ? "当前查看的是最近一次任务。"
          : "当前查看的是一条历史任务结果。",
        specValue: `${aspectRatioLabel} · ${resolutionLabel} · ${durationLabel} 秒`,
        specHint: "规格优先从任务请求恢复，缺失时回退到当前工作台状态。",
        syncValue: syncCopy.label,
        syncHint: syncCopy.hint,
        timelineValue: `创建 ${formatTaskTime(focusedTask.createdAt)}`,
        timelineHint: `最近更新 ${formatTaskTime(
          focusedTask.updatedAt ?? focusedTask.createdAt,
        )} · 任务 ID ${focusedTask.id}`,
        badgeLabel: isLatestFocused ? "最新结果" : "历史结果",
        description: isLatestFocused
          ? "这里固定展示当前聚焦任务的上下文，切换任务后会一起更新。"
          : "你正在查看一条历史任务，下面的信息与主预览都跟随该任务同步。",
      };
    }, [
      focusedTask,
      latestTask?.id,
      state.aspectRatio,
      state.duration,
      state.model,
      state.prompt,
      state.providerId,
      state.resolution,
    ]);

    return (
      <WorkspaceWrapper>
        <PageShell>
          {!isGenerated ? (
            <HeroPanel>
              <HeroHeader>
                <HeroCopy>
                  <Eyebrow>VIDEO WORKBENCH</Eyebrow>
                  <HeroTitleRow>
                    <IconBox>
                      <Video size={28} />
                    </IconBox>
                    <HeroTitle>视频创作</HeroTitle>
                    <WorkbenchInfoTip
                      ariaLabel="视频创作说明"
                      content="用一句清晰的场景描述启动视频生成，再逐步补充镜头运动、情绪和画面锚点。先让结构成立，再慢慢叠加参考图与参数约束。"
                      tone="sky"
                    />
                  </HeroTitleRow>
                </HeroCopy>

                <StatsGrid>
                  {summaryCards.map((item) => (
                    <StatCard key={item.label}>
                      <StatHeader>
                        <StatLabel>{item.label}</StatLabel>
                        <WorkbenchInfoTip
                          ariaLabel={`${item.label}说明`}
                          content={item.hint}
                          tone="sky"
                        />
                      </StatHeader>
                      <StatValue>{item.value}</StatValue>
                    </StatCard>
                  ))}
                </StatsGrid>
              </HeroHeader>

              <PromptBlock>
                <PromptInput
                  state={state}
                  onStateChange={onStateChange}
                  onGenerate={handleGenerate}
                />
              </PromptBlock>
            </HeroPanel>
          ) : (
            <>
              <WorkspaceHeaderCard>
                <WorkspaceHeaderTop>
                  <WorkspaceHeaderCopy>
                    <Eyebrow>VIDEO SESSION</Eyebrow>
                    <WorkspaceTitleRow>
                      <WorkspaceTitle>
                        继续调整提示词并追踪最新结果
                      </WorkspaceTitle>
                      <WorkbenchInfoTip
                        ariaLabel="视频会话说明"
                        content="这里集中展示主预览、历史任务和当前输入入口，避免在多个视图之间来回切换。"
                        tone="sky"
                      />
                    </WorkspaceTitleRow>
                    <HeaderBadgeRow>
                      <StatusBadge $tone={workspaceStatus.tone}>
                        {workspaceStatus.label}
                      </StatusBadge>
                      <HeaderChip>
                        {tasks.length > 0
                          ? `累计 ${tasks.length} 个任务`
                          : "暂无历史任务"}
                      </HeaderChip>
                      <HeaderChip>
                        {state.model || "待选择模型"} · {state.resolution}
                      </HeaderChip>
                    </HeaderBadgeRow>
                  </WorkspaceHeaderCopy>

                  <StatsGrid>
                    {summaryCards.map((item) => (
                      <StatCard key={item.label}>
                        <StatHeader>
                          <StatLabel>{item.label}</StatLabel>
                          <WorkbenchInfoTip
                            ariaLabel={`${item.label}说明`}
                            content={item.hint}
                            tone="sky"
                          />
                        </StatHeader>
                        <StatValue>{item.value}</StatValue>
                      </StatCard>
                    ))}
                  </StatsGrid>
                </WorkspaceHeaderTop>

                <PromptInput
                  state={state}
                  onStateChange={onStateChange}
                  onGenerate={handleGenerate}
                />
              </WorkspaceHeaderCard>

              <ResultGrid>
                <ResultPanel>
                  <ResultPanelHeader>
                    <ResultPanelCopy>
                      <ResultPanelTitle>主预览</ResultPanelTitle>
                      <ResultPanelDescription>
                        {workspaceStatus.detail}
                      </ResultPanelDescription>
                    </ResultPanelCopy>
                    <StatusBadge $tone={workspaceStatus.tone}>
                      {workspaceStatus.label}
                    </StatusBadge>
                  </ResultPanelHeader>

                  <StageFrame>
                    {state.status === "success" && state.videoUrl ? (
                      <StageVideo controls src={state.videoUrl} />
                    ) : state.status === "error" ? (
                      <StagePlaceholder>
                        <StagePlaceholderIcon>
                          <Video size={30} />
                        </StagePlaceholderIcon>
                        <StagePlaceholderTitle>
                          这次生成没有成功
                        </StagePlaceholderTitle>
                        <StagePlaceholderDescription>
                          {state.errorMessage ??
                            "请检查模型配置、提示词或参考图后再试。"}
                        </StagePlaceholderDescription>
                      </StagePlaceholder>
                    ) : (
                      <StagePlaceholder>
                        <StagePlaceholderIcon>
                          <Sparkles size={30} />
                        </StagePlaceholderIcon>
                        <StagePlaceholderTitle>
                          {state.status === "generating"
                            ? "正在生成视频"
                            : "等待第一条生成结果"}
                        </StagePlaceholderTitle>
                        <StagePlaceholderDescription>
                          {state.status === "generating"
                            ? "任务已提交，右侧卡片会持续刷新进度。你可以继续优化提示词，准备下一轮迭代。"
                            : "任务完成后，结果会自动显示在这里。"}
                        </StagePlaceholderDescription>
                      </StagePlaceholder>
                    )}
                  </StageFrame>

                  <StageFooter>
                    <StageFooterTips>
                      <WorkbenchInfoTip
                        ariaLabel="主预览说明"
                        label="同步规则"
                        variant="pill"
                        tone="sky"
                        align="start"
                        content="成功结果会自动同步到项目素材；切换历史任务预览不会覆盖你当前输入的提示词。"
                      />
                    </StageFooterTips>
                    {focusedTask ? (
                      <TaskCounter>
                        当前任务更新于{" "}
                        {formatTaskTime(
                          focusedTask.updatedAt ?? focusedTask.createdAt,
                        )}
                      </TaskCounter>
                    ) : null}
                  </StageFooter>

                  {focusedTaskSummary ? (
                    <FocusedTaskPanel data-testid="video-focused-task-panel">
                      <FocusedTaskHeader>
                        <FocusedTaskCopy>
                          <FocusedTaskTitle>当前查看任务</FocusedTaskTitle>
                          <FocusedTaskDescription>
                            {focusedTaskSummary.description}
                          </FocusedTaskDescription>
                        </FocusedTaskCopy>
                        <TaskCounter>
                          {focusedTaskSummary.badgeLabel}
                        </TaskCounter>
                      </FocusedTaskHeader>

                      <FocusedTaskPrompt data-testid="video-focused-task-prompt">
                        {focusedTaskSummary.prompt}
                      </FocusedTaskPrompt>

                      <FocusedTaskMetaGrid>
                        <FocusedTaskMetaCard data-testid="video-focused-task-source">
                          <FocusedTaskMetaLabel>模型链路</FocusedTaskMetaLabel>
                          <FocusedTaskMetaValue>
                            {focusedTaskSummary.sourceValue}
                          </FocusedTaskMetaValue>
                          <FocusedTaskMetaHint>
                            {focusedTaskSummary.sourceHint}
                          </FocusedTaskMetaHint>
                        </FocusedTaskMetaCard>

                        <FocusedTaskMetaCard data-testid="video-focused-task-spec">
                          <FocusedTaskMetaLabel>生成规格</FocusedTaskMetaLabel>
                          <FocusedTaskMetaValue>
                            {focusedTaskSummary.specValue}
                          </FocusedTaskMetaValue>
                          <FocusedTaskMetaHint>
                            {focusedTaskSummary.specHint}
                          </FocusedTaskMetaHint>
                        </FocusedTaskMetaCard>

                        <FocusedTaskMetaCard data-testid="video-focused-task-sync">
                          <FocusedTaskMetaLabel>结果同步</FocusedTaskMetaLabel>
                          <FocusedTaskMetaValue>
                            {focusedTaskSummary.syncValue}
                          </FocusedTaskMetaValue>
                          <FocusedTaskMetaHint>
                            {focusedTaskSummary.syncHint}
                          </FocusedTaskMetaHint>
                        </FocusedTaskMetaCard>

                        <FocusedTaskMetaCard data-testid="video-focused-task-timeline">
                          <FocusedTaskMetaLabel>任务时间</FocusedTaskMetaLabel>
                          <FocusedTaskMetaValue>
                            {focusedTaskSummary.timelineValue}
                          </FocusedTaskMetaValue>
                          <FocusedTaskMetaHint>
                            {focusedTaskSummary.timelineHint}
                          </FocusedTaskMetaHint>
                        </FocusedTaskMetaCard>
                      </FocusedTaskMetaGrid>
                    </FocusedTaskPanel>
                  ) : null}
                </ResultPanel>

                <ResultPanel>
                  <ResultPanelHeader>
                    <ResultPanelCopy>
                      <ResultPanelTitleRow>
                        <ResultPanelTitle>最近任务</ResultPanelTitle>
                        <WorkbenchInfoTip
                          ariaLabel="最近任务说明"
                          content="按时间倒序展示最新视频任务，便于切换预览与排查失败原因。"
                          tone="sky"
                        />
                      </ResultPanelTitleRow>
                    </ResultPanelCopy>
                    <TaskCounter>{tasks.length} 条</TaskCounter>
                  </ResultPanelHeader>

                  {tasks.length === 0 ? (
                    <EmptyTasks>
                      当前还没有可展示的任务记录。先提交一次视频生成，结果会自动沉淀到这里。
                    </EmptyTasks>
                  ) : (
                    <TaskList>
                      {tasks.map((task) => {
                        const progress = clampProgress(task.progress);
                        const tone = getStatusTone(task.status);
                        const syncMessage =
                          task.status === "success"
                            ? task.resourceMaterialId
                              ? "已同步到项目素材"
                              : task.resourceSaveError
                                ? `素材入库失败：${task.resourceSaveError}`
                                : "结果已生成，正在同步到项目素材"
                            : task.status === "error"
                              ? (task.errorMessage ?? "任务执行失败")
                              : task.status === "cancelled"
                                ? "任务已取消"
                                : progress != null
                                  ? `当前进度 ${progress}%`
                                  : "正在等待服务端返回进度";

                        return (
                          <TaskCard
                            key={task.id}
                            data-testid={`video-task-card-${task.id}`}
                            $active={task.id === activeTaskId}
                          >
                            <TaskTopRow>
                              <TaskMetaRow>
                                <StatusBadge $tone={tone}>
                                  {getTaskStatusLabel(task.status)}
                                </StatusBadge>
                                <span>{formatTaskTime(task.createdAt)}</span>
                              </TaskMetaRow>
                              <TaskMetaRow>
                                <span>{task.providerId}</span>
                                <span>{task.model}</span>
                              </TaskMetaRow>
                            </TaskTopRow>

                            <TaskPrompt>{task.prompt}</TaskPrompt>

                            {progress != null &&
                            (task.status === "pending" ||
                              task.status === "processing") ? (
                              <TaskProgressTrack>
                                <TaskProgressBar $progress={progress} />
                              </TaskProgressTrack>
                            ) : null}

                            <TaskAssistText
                              $tone={
                                task.status === "success"
                                  ? "success"
                                  : task.status === "error"
                                    ? "error"
                                    : "default"
                              }
                            >
                              {syncMessage}
                            </TaskAssistText>

                            <TaskBottomRow>
                              <TaskMetaRow>
                                <span>ID {task.id}</span>
                              </TaskMetaRow>
                              {task.resultUrl ? (
                                <TaskActionButton
                                  data-testid={`video-task-preview-${task.id}`}
                                  type="button"
                                  onClick={() => handlePreviewTask(task)}
                                >
                                  {task.id === activeTaskId
                                    ? "当前预览"
                                    : "切换预览"}
                                  <ArrowUpRight size={14} />
                                </TaskActionButton>
                              ) : null}
                            </TaskBottomRow>
                          </TaskCard>
                        );
                      })}
                    </TaskList>
                  )}
                </ResultPanel>
              </ResultGrid>
            </>
          )}
        </PageShell>
      </WorkspaceWrapper>
    );
  },
);

VideoWorkspace.displayName = "VideoWorkspace";
