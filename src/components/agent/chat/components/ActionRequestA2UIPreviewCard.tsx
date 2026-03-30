import { cn } from "@/lib/utils";
import {
  CHAT_A2UI_TASK_CARD_PRESET,
  TIMELINE_A2UI_TASK_CARD_PRESET,
} from "@/lib/workspace/a2ui";
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
      return "已记下";
    case "submitted":
      return "已确认";
    default:
      return "等你补充";
  }
}

function resolveTitle(request: ActionRequired): string {
  return request.status === "submitted" || request.status === "queued"
    ? "你补充的信息"
    : "等你补充信息";
}

function resolveSubtitle(
  request: ActionRequired,
  context: "chat" | "timeline",
): string {
  if (request.status === "queued") {
    return "已经记下了，系统就绪后会继续。";
  }

  if (request.status === "submitted") {
    return context === "timeline"
      ? "这一步已经确认，继续往下做。"
      : "收到这一步了，继续往下做。";
  }

  return context === "timeline"
    ? "去输入区把这一步补完。"
    : "先补这一步，我再继续当前对话。";
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
