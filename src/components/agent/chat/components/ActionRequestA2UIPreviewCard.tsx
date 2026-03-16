import { cn } from "@/lib/utils";
import {
  CHAT_A2UI_TASK_CARD_PRESET,
  TIMELINE_A2UI_TASK_CARD_PRESET,
} from "@/components/content-creator/a2ui/taskCardPresets";
import type { ActionRequired } from "../types";
import {
  buildActionRequestA2UI,
  resolveActionRequestInitialFormData,
} from "../utils/actionRequestA2UI";
import { A2UITaskCard } from "./A2UITaskCard";

interface ActionRequestA2UIPreviewCardProps {
  request: ActionRequired;
  compact?: boolean;
  context?: "chat" | "timeline";
  className?: string;
  readOnly?: boolean;
}

function resolveStatusLabel(request: ActionRequired): string {
  switch (request.status) {
    case "queued":
      return "已记录";
    case "submitted":
      return "已确认";
    default:
      return "待补充";
  }
}

function resolveTitle(request: ActionRequired): string {
  return request.status === "submitted" || request.status === "queued"
    ? "已确认的补充信息"
    : "补充信息";
}

function resolveSubtitle(
  request: ActionRequired,
  context: "chat" | "timeline",
): string {
  if (request.status === "queued") {
    return "答案已记录，等待系统请求就绪后会自动继续执行。";
  }

  if (request.status === "submitted") {
    return context === "timeline"
      ? "该阶段的问答已完成，回合记录改为结构化回显。"
      : "已收到你的补充信息，助手会继续执行后续流程。";
  }

  return context === "timeline"
    ? "该阶段需要补充信息，请在输入区表单中完成确认后继续。"
    : "请先完成这一步，我再继续当前对话。";
}

export function ActionRequestA2UIPreviewCard({
  request,
  compact = false,
  context = "chat",
  className,
  readOnly = true,
}: ActionRequestA2UIPreviewCardProps) {
  const response = buildActionRequestA2UI(request);
  if (!response) {
    return null;
  }

  const preset =
    context === "timeline"
      ? TIMELINE_A2UI_TASK_CARD_PRESET
      : CHAT_A2UI_TASK_CARD_PRESET;
  const previewResponse =
    readOnly || request.status === "submitted" || request.status === "queued"
      ? {
          ...response,
          submitAction: undefined,
        }
      : response;

  return (
    <A2UITaskCard
      response={previewResponse}
      compact={compact}
      preview={readOnly}
      preset={preset}
      title={resolveTitle(request)}
      subtitle={resolveSubtitle(request, context)}
      statusLabel={resolveStatusLabel(request)}
      initialFormData={resolveActionRequestInitialFormData(request)}
      className={cn(
        readOnly &&
          "[&_button]:pointer-events-none [&_button]:cursor-default [&_input]:pointer-events-none [&_textarea]:pointer-events-none",
        className,
      )}
    />
  );
}

export default ActionRequestA2UIPreviewCard;
