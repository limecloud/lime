import type {
  TurnStartResponse,
  TurnSteerResponse,
} from "@limecloud/app-server-client";
import { logAgentDebug } from "@/lib/agentDebug";

export interface RuntimeAcceptanceContext {
  readonly sessionId: string;
  readonly threadId: string;
  readonly clientUserMessageId?: string;
}

export type RuntimeAcceptanceReceipt = RuntimeAcceptanceContext & {
  readonly kind: "start" | "steer";
  readonly turnId: string;
};

function requireId(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim() !== value) {
    throw new Error("Invalid runtime acceptance identity");
  }
  return value;
}

export function requireTurnStartResponse(value: unknown): TurnStartResponse {
  const turn = (value as TurnStartResponse | null | undefined)?.turn;
  requireId(turn?.id);
  if (
    !turn ||
    !["completed", "failed", "inProgress", "interrupted"].includes(turn.status)
  ) {
    throw new Error("Invalid turn/start acceptance response");
  }
  return value as TurnStartResponse;
}

export function createRuntimeAcceptanceReceipt(
  context: RuntimeAcceptanceContext,
  kind: RuntimeAcceptanceReceipt["kind"],
  turnId: unknown,
): RuntimeAcceptanceReceipt {
  return Object.freeze({
    kind,
    sessionId: requireId(context.sessionId),
    threadId: requireId(context.threadId),
    turnId: requireId(turnId),
    ...(context.clientUserMessageId === undefined
      ? {}
      : {
          clientUserMessageId: requireId(context.clientUserMessageId),
        }),
  });
}

export function createTurnStartAcceptance(
  context: RuntimeAcceptanceContext,
  response: TurnStartResponse,
): RuntimeAcceptanceReceipt {
  return createRuntimeAcceptanceReceipt(
    context,
    "start",
    requireTurnStartResponse(response).turn.id,
  );
}

export function createTurnSteerAcceptance(
  context: RuntimeAcceptanceContext,
  expectedTurnId: string,
  response: TurnSteerResponse,
): RuntimeAcceptanceReceipt {
  if (requireId(response?.turnId) !== requireId(expectedTurnId)) {
    throw new Error("turn/steer returned mismatched turnId");
  }
  return createRuntimeAcceptanceReceipt(context, "steer", expectedTurnId);
}

export function requireRuntimeAcceptanceReceipt(
  value: RuntimeAcceptanceReceipt,
): RuntimeAcceptanceReceipt {
  if (!value || (value.kind !== "start" && value.kind !== "steer")) {
    throw new Error("Invalid runtime acceptance receipt");
  }
  return createRuntimeAcceptanceReceipt(value, value.kind, value.turnId);
}

export type RuntimeAcceptancePostProcessingPhase =
  | "start_callback"
  | "start_projection"
  | "start_notifications"
  | "observer"
  | "accepted_time"
  | "accepted_submit"
  | "accepted_metric"
  | "accepted_log"
  | "terminal_recovery_poll"
  | "steer_read_model"
  | "steer_projection";

export function reportRuntimeAcceptancePostProcessingFailure(
  phase: RuntimeAcceptancePostProcessingPhase,
  context: {
    readonly threadId: string;
    readonly sessionId?: string;
    readonly turnId?: string;
  },
): void {
  try {
    // 只记录请求 identity 和固定调用点，不回显异常正文或用户输入。
    logAgentDebug(
      "AgentRuntime",
      "acceptance.postProcessingFailed",
      {
        phase,
        threadId: context.threadId,
        ...(context.sessionId ? { sessionId: context.sessionId } : {}),
        ...(context.turnId ? { turnId: context.turnId } : {}),
      },
      { level: "error" },
    );
  } catch {
    console.error(
      "[AgentRuntime] acceptance post-processing diagnostic failed",
    );
  }
}

export function runRuntimeAcceptanceEffect(
  receipt: RuntimeAcceptanceReceipt,
  phase: RuntimeAcceptancePostProcessingPhase,
  effect: () => void,
): void {
  try {
    effect();
  } catch {
    reportRuntimeAcceptancePostProcessingFailure(phase, receipt);
  }
}
