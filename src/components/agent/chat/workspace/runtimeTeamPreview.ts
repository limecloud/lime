import type { AssistantDraftState } from "../hooks/agentChatShared";
import type { TeamWorkspaceRuntimeFormationState } from "../teamWorkspaceRuntime";
import type { AgentRuntimeStatus, Message, MessageImage } from "../types";

export interface RuntimeTeamDispatchPreviewSnapshot {
  key: string;
  prompt: string;
  images: MessageImage[];
  baseMessageCount: number;
  status: "forming" | "formed" | "failed";
  formationState?: TeamWorkspaceRuntimeFormationState | null;
  failureMessage?: string | null;
}

export function resolveRuntimeTeamDispatchPreviewState(
  snapshot: RuntimeTeamDispatchPreviewSnapshot | null | undefined,
): TeamWorkspaceRuntimeFormationState | null {
  const formationState = snapshot?.formationState ?? null;
  if (!snapshot || !formationState) {
    return null;
  }

  const normalizedFailureMessage = snapshot.failureMessage?.trim() || null;
  if (
    snapshot.status === formationState.status &&
    !(snapshot.status === "failed" && normalizedFailureMessage)
  ) {
    return formationState;
  }

  return {
    ...formationState,
    status: snapshot.status,
    errorMessage:
      snapshot.status === "failed"
        ? normalizedFailureMessage ||
          formationState.errorMessage?.trim() ||
          null
        : null,
  };
}

function buildRuntimeTeamMemberPlanLines(
  state: TeamWorkspaceRuntimeFormationState,
): string[] {
  const members = state.members.slice(0, 3);
  const lines = members.map((member, index) => {
    const label = member.label.trim() || `成员 ${index + 1}`;
    const summary = member.summary.trim() || "负责分担当前任务中的一部分工作。";
    return `${index + 1}. ${label}：${summary}`;
  });

  if (state.members.length > members.length) {
    lines.push(
      `另外还有 ${state.members.length - members.length} 位成员会继续配合处理。`,
    );
  }

  return lines;
}

export function buildRuntimeTeamAssistantDraft(
  state: TeamWorkspaceRuntimeFormationState | null | undefined,
): AssistantDraftState | undefined {
  if (!state || state.status !== "formed") {
    return undefined;
  }

  const teamLabel =
    state.label?.trim() || state.blueprint?.label?.trim() || "当前协作方案";
  const summary =
    state.summary?.trim() || state.blueprint?.summary?.trim() || "";
  const planLines = buildRuntimeTeamMemberPlanLines(state);
  const contentSections = [
    `我已经为这项任务准备了「${teamLabel}」。`,
    summary ? `会先按“${summary}”来推进。` : null,
    planLines.length > 0 ? `分工如下：\n${planLines.join("\n")}` : null,
    "接下来我会让他们分别处理，再把关键进展、风险和需要你确认的事项汇总给你。",
  ].filter(Boolean);

  const initialRuntimeStatus: AgentRuntimeStatus = {
    phase: "routing",
    title: "协作分工已准备好",
    detail:
      summary || "已整理好当前任务的分工，接下来会分别展开处理并同步结果。",
    checkpoints: [
      `当前方案：${teamLabel}`,
      `已安排 ${Math.max(state.members.length, 1)} 位协作成员`,
      "主对话会持续同步关键进展",
    ],
  };

  const waitingRuntimeStatus: AgentRuntimeStatus = {
    phase: "routing",
    title: "协作成员开始接手",
    detail:
      summary || "分工已经确认，协作成员会按各自职责继续处理并回传关键结果。",
    checkpoints: [
      `当前方案：${teamLabel}`,
      planLines[0] || "成员会分别接手自己的部分",
      "主对话会持续同步关键进展",
    ],
  };

  return {
    content: contentSections.join("\n\n"),
    initialRuntimeStatus,
    waitingRuntimeStatus,
  };
}

export function buildRuntimeTeamDispatchPreviewMessages(
  snapshot: RuntimeTeamDispatchPreviewSnapshot,
): Message[] {
  const normalizedPrompt = snapshot.prompt.trim();
  const timestamp = new Date();
  const formedAssistantDraft =
    snapshot.status === "formed"
      ? buildRuntimeTeamAssistantDraft(snapshot.formationState)
      : undefined;
  const formedTeamLabel =
    snapshot.formationState?.label?.trim() ||
    snapshot.formationState?.blueprint?.label?.trim() ||
    "当前协作方案";
  const formedSummary =
    snapshot.formationState?.summary?.trim() ||
    snapshot.formationState?.blueprint?.summary?.trim() ||
    "";
  const assistantRuntimeStatus =
    snapshot.status === "failed"
      ? {
          phase: "failed" as const,
          title: "Team 调度准备失败",
          detail:
            snapshot.failureMessage?.trim() ||
            "这次 Team 组建失败，已回退到普通对话发送。",
        }
      : snapshot.status === "formed"
        ? formedAssistantDraft?.initialRuntimeStatus || {
            phase: "routing" as const,
            title: "协作分工已准备好",
            detail:
              formedSummary ||
              "已整理好当前任务的分工，接下来会分别展开处理并同步结果。",
            checkpoints: [
              `当前方案：${formedTeamLabel}`,
              "协作成员会按分工开始接手",
              "主对话会持续同步关键进展",
            ],
          }
        : {
            phase: "routing" as const,
            title: "正在组建 Team",
            detail:
              "系统正在根据当前任务安排分工，会先接入合适的成员，再把关键进展持续汇总回主对话。",
            checkpoints: [
              "确认当前任务目标",
              "安排协作分工",
              "等待成员接手处理",
            ],
          };

  return [
    {
      id: `runtime-team-dispatch:${snapshot.key}:user`,
      role: "user",
      content: normalizedPrompt,
      images: snapshot.images.length > 0 ? snapshot.images : undefined,
      timestamp,
    },
    {
      id: `runtime-team-dispatch:${snapshot.key}:assistant`,
      role: "assistant",
      content:
        snapshot.status === "failed"
          ? "这次 Team 调度准备失败，已回退到普通执行。"
          : snapshot.status === "formed"
            ? formedAssistantDraft?.content ||
              `我已经为这项任务准备了「${formedTeamLabel}」。\n\n接下来我会让他们分别处理，再把关键进展和结果汇总给你。`
            : "我会先安排协作分工，再把关键进展和结果汇总给你。",
      timestamp: new Date(timestamp.getTime() + 1),
      isThinking: snapshot.status === "forming",
      runtimeStatus: assistantRuntimeStatus,
    },
  ];
}
