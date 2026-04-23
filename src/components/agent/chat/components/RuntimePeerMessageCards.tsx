import React from "react";
import {
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  GitBranch,
  ShieldAlert,
  ShieldX,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MarkdownRenderer } from "./MarkdownRenderer";
import {
  parseRuntimePeerMessageEnvelopes,
  type RuntimePeerEnvelope,
  type RuntimePeerMessageBody,
} from "../utils/runtimePeerMessageDisplay";

interface RuntimePeerMessageCardsProps {
  text: string;
}

interface RuntimePeerTone {
  icon: React.ComponentType<{ className?: string }>;
  badge: string;
  title: string;
  shellClassName: string;
  iconClassName: string;
}

function resolveEnvelopeTone(
  envelope: RuntimePeerEnvelope,
  body: RuntimePeerMessageBody,
): RuntimePeerTone {
  const baseBadge = envelope.kind === "teammate" ? "协作消息" : "跨会话";
  switch (body.kind) {
    case "plan_approval_request":
      return {
        icon: ClipboardList,
        badge: baseBadge,
        title: "计划审批请求",
        shellClassName:
          "border-sky-200 bg-sky-50/85 shadow-sky-950/5 dark:border-sky-500/30 dark:bg-sky-500/10",
        iconClassName:
          "border-sky-200 bg-white text-sky-700 dark:border-sky-400/30 dark:bg-sky-500/10 dark:text-sky-200",
      };
    case "plan_approval_response":
      if (body.approved === true) {
        return {
          icon: ClipboardCheck,
          badge: baseBadge,
          title: "计划已批准",
          shellClassName:
            "border-emerald-200 bg-emerald-50/85 shadow-emerald-950/5 dark:border-emerald-500/30 dark:bg-emerald-500/10",
          iconClassName:
            "border-emerald-200 bg-white text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-200",
        };
      }
      return {
        icon: ShieldX,
        badge: baseBadge,
        title: "计划被拒绝",
        shellClassName:
          "border-rose-200 bg-rose-50/85 shadow-rose-950/5 dark:border-rose-500/30 dark:bg-rose-500/10",
        iconClassName:
          "border-rose-200 bg-white text-rose-700 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-200",
      };
    case "shutdown_request":
      return {
        icon: ShieldAlert,
        badge: baseBadge,
        title: "结束任务请求",
        shellClassName:
          "border-amber-200 bg-amber-50/85 shadow-amber-950/5 dark:border-amber-500/30 dark:bg-amber-500/10",
        iconClassName:
          "border-amber-200 bg-white text-amber-700 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200",
      };
    case "shutdown_rejected":
      return {
        icon: ShieldX,
        badge: baseBadge,
        title: "结束任务被拒绝",
        shellClassName:
          "border-slate-200 bg-slate-50/90 shadow-slate-950/5 dark:border-slate-500/30 dark:bg-slate-500/10",
        iconClassName:
          "border-slate-200 bg-white text-slate-700 dark:border-slate-400/30 dark:bg-slate-500/10 dark:text-slate-200",
      };
    case "task_assignment":
      return {
        icon: GitBranch,
        badge: baseBadge,
        title: "任务分配",
        shellClassName:
          "border-violet-200 bg-violet-50/80 shadow-violet-950/5 dark:border-violet-500/30 dark:bg-violet-500/10",
        iconClassName:
          "border-violet-200 bg-white text-violet-700 dark:border-violet-400/30 dark:bg-violet-500/10 dark:text-violet-200",
      };
    case "task_completed":
      return {
        icon: CheckCircle2,
        badge: baseBadge,
        title: "任务完成",
        shellClassName:
          "border-emerald-200 bg-emerald-50/85 shadow-emerald-950/5 dark:border-emerald-500/30 dark:bg-emerald-500/10",
        iconClassName:
          "border-emerald-200 bg-white text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-200",
      };
    case "plain":
    default:
      return {
        icon: envelope.kind === "teammate" ? Users : GitBranch,
        badge: baseBadge,
        title: envelope.kind === "teammate" ? "协作者消息" : "跨会话消息",
        shellClassName:
          "border-slate-200 bg-slate-50/90 shadow-slate-950/5 dark:border-slate-500/30 dark:bg-slate-500/10",
        iconClassName:
          "border-slate-200 bg-white text-slate-700 dark:border-slate-400/30 dark:bg-slate-500/10 dark:text-slate-200",
      };
  }
}

function renderEnvelopeDetail(body: RuntimePeerMessageBody): React.ReactNode {
  switch (body.kind) {
    case "plain":
      return body.markdown ? <MarkdownRenderer content={body.markdown} /> : null;
    case "shutdown_request":
      return body.reason ? (
        <div className="text-sm leading-6 text-slate-700 dark:text-slate-200">
          {body.reason}
        </div>
      ) : (
        <div className="text-sm leading-6 text-slate-600 dark:text-slate-300">
          协作者请求结束当前任务。
        </div>
      );
    case "shutdown_rejected":
      return (
        <div className="space-y-2">
          {body.reason ? (
            <div className="text-sm leading-6 text-slate-700 dark:text-slate-200">
              {body.reason}
            </div>
          ) : null}
          <div className="text-xs leading-5 text-slate-500 dark:text-slate-400">
            协作者会继续处理当前任务，可在稍后再次请求结束。
          </div>
        </div>
      );
    case "plan_approval_request":
      return (
        <div className="space-y-3">
          {body.planFilePath ? (
            <div className="text-xs font-medium leading-5 text-sky-700 dark:text-sky-200">
              计划文件：{body.planFilePath}
            </div>
          ) : null}
          {body.planContent ? (
            <div className="rounded-2xl border border-white/80 bg-white/85 px-3 py-3 shadow-sm shadow-slate-950/5 dark:border-white/10 dark:bg-slate-950/20">
              <MarkdownRenderer content={body.planContent} />
            </div>
          ) : (
            <div className="text-sm leading-6 text-slate-600 dark:text-slate-300">
              协作者请求审批当前执行计划。
            </div>
          )}
        </div>
      );
    case "plan_approval_response":
      if (body.approved === true) {
        return (
          <div className="text-sm leading-6 text-slate-700 dark:text-slate-200">
            当前计划已获批准，可以继续执行后续实现。
          </div>
        );
      }
      return (
        <div className="space-y-2">
          {body.feedback ? (
            <div className="text-sm leading-6 text-slate-700 dark:text-slate-200">
              {body.feedback}
            </div>
          ) : null}
          <div className="text-xs leading-5 text-slate-500 dark:text-slate-400">
            请根据反馈调整计划后再继续推进。
          </div>
        </div>
      );
    case "task_assignment":
      return (
        <div className="space-y-2">
          {body.assignedBy ? (
            <div className="text-xs leading-5 text-slate-500 dark:text-slate-400">
              分配者：{body.assignedBy}
            </div>
          ) : null}
          {(body.taskId || body.subject) && (
            <div className="text-sm font-medium leading-6 text-slate-800 dark:text-slate-100">
              {body.taskId ? `#${body.taskId}` : "任务"}
              {body.subject ? ` · ${body.subject}` : ""}
            </div>
          )}
          {body.description ? (
            <MarkdownRenderer content={body.description} />
          ) : (
            <div className="text-sm leading-6 text-slate-600 dark:text-slate-300">
              协作者已收到新的执行任务。
            </div>
          )}
        </div>
      );
    case "task_completed":
      return (
        <div className="text-sm leading-6 text-slate-700 dark:text-slate-200">
          已完成
          {body.taskId ? ` #${body.taskId}` : " 当前任务"}
          {body.subject ? ` · ${body.subject}` : ""}。
        </div>
      );
    default:
      return null;
  }
}

function RuntimePeerMessageCard({
  envelope,
}: {
  envelope: RuntimePeerEnvelope;
}) {
  const tone = resolveEnvelopeTone(envelope, envelope.body);
  const Icon = tone.icon;

  return (
    <div
      className={cn(
        "rounded-[22px] border px-4 py-3 shadow-sm shadow-slate-950/5",
        tone.shellClassName,
      )}
      data-testid="runtime-peer-message-card"
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border shadow-sm shadow-slate-950/5",
            tone.iconClassName,
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-white/80 bg-white/80 px-2.5 py-1 text-[11px] font-medium leading-none text-slate-600 shadow-sm shadow-slate-950/5 dark:border-white/10 dark:bg-slate-950/20 dark:text-slate-300">
              {tone.badge}
            </span>
            <span className="text-sm font-semibold leading-6 text-slate-900 dark:text-slate-50">
              {tone.title}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
            <span>来自 {envelope.sender}</span>
            {envelope.summary ? <span>{envelope.summary}</span> : null}
          </div>
          <div className="mt-3 min-w-0">{renderEnvelopeDetail(envelope.body)}</div>
        </div>
      </div>
    </div>
  );
}

export function RuntimePeerMessageCards({
  text,
}: RuntimePeerMessageCardsProps): React.ReactNode {
  const envelopes = parseRuntimePeerMessageEnvelopes(text);
  if (envelopes.length === 0) {
    return null;
  }

  return (
    <div
      className="flex flex-col gap-3"
      data-testid="runtime-peer-message-cards"
    >
      {envelopes.map((envelope, index) => (
        <RuntimePeerMessageCard
          key={`${envelope.kind}:${envelope.sender}:${index}`}
          envelope={envelope}
        />
      ))}
    </div>
  );
}
