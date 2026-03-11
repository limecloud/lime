import type { StreamEvent } from "@/lib/api/agentStream";
import { updateCrashContext } from "@/lib/crashReporting";

const EVENT_PUBLISH_INTERVAL = 20;
const PREVIEW_MAX_CHARS = 240;

export interface StreamDiagnosticsStartPayload {
  sessionId: string;
  eventName: string;
  assistantMessageId: string;
  source: string;
}

export interface StreamDiagnosticsSnapshot {
  source: string;
  sessionId: string;
  eventName: string;
  assistantMessageId: string;
  state: "streaming" | "done" | "error";
  startedAt: string;
  lastEventAt: string;
  totalEvents: number;
  invalidEventCount: number;
  textDeltaCount: number;
  thinkingDeltaCount: number;
  toolStartCount: number;
  toolEndCount: number;
  actionRequiredCount: number;
  contextTraceCount: number;
  warningCount: number;
  doneCount: number;
  finalDoneCount: number;
  errorCount: number;
  maxTextDeltaChars: number;
  maxToolOutputChars: number;
  maxContextTraceSteps: number;
  lastEventType?: string;
  lastToolName?: string;
  lastToolId?: string;
  lastWarningCode?: string;
  lastErrorMessage?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function truncatePreview(value: string | undefined): string | undefined {
  if (!value) return value;
  if (value.length <= PREVIEW_MAX_CHARS) {
    return value;
  }
  return `${value.slice(0, PREVIEW_MAX_CHARS)}...`;
}

export function createStreamDiagnosticsReporter(componentName: string) {
  let snapshot: StreamDiagnosticsSnapshot | null = null;
  let lastPublishedTotalEvents = 0;

  const publish = (force = false) => {
    if (!snapshot) return;
    if (
      !force &&
      snapshot.totalEvents - lastPublishedTotalEvents < EVENT_PUBLISH_INTERVAL
    ) {
      return;
    }
    lastPublishedTotalEvents = snapshot.totalEvents;
    updateCrashContext({
      agent_stream_diag: {
        component: componentName,
        ...snapshot,
      },
    });
  };

  return {
    start(payload: StreamDiagnosticsStartPayload) {
      const startedAt = nowIso();
      snapshot = {
        source: payload.source,
        sessionId: payload.sessionId,
        eventName: payload.eventName,
        assistantMessageId: payload.assistantMessageId,
        state: "streaming",
        startedAt,
        lastEventAt: startedAt,
        totalEvents: 0,
        invalidEventCount: 0,
        textDeltaCount: 0,
        thinkingDeltaCount: 0,
        toolStartCount: 0,
        toolEndCount: 0,
        actionRequiredCount: 0,
        contextTraceCount: 0,
        warningCount: 0,
        doneCount: 0,
        finalDoneCount: 0,
        errorCount: 0,
        maxTextDeltaChars: 0,
        maxToolOutputChars: 0,
        maxContextTraceSteps: 0,
      };
      lastPublishedTotalEvents = 0;
      publish(true);
    },

    recordInvalidEvent(payload: unknown) {
      if (!snapshot) return;
      snapshot.totalEvents += 1;
      snapshot.invalidEventCount += 1;
      snapshot.lastEventAt = nowIso();
      snapshot.lastEventType = "invalid";
      try {
        snapshot.lastErrorMessage = truncatePreview(JSON.stringify(payload));
      } catch {
        snapshot.lastErrorMessage = "[unserializable_payload]";
      }
      publish(true);
    },

    record(event: StreamEvent) {
      if (!snapshot) return;
      snapshot.totalEvents += 1;
      snapshot.lastEventAt = nowIso();
      snapshot.lastEventType = event.type;

      switch (event.type) {
        case "text_delta": {
          snapshot.textDeltaCount += 1;
          snapshot.maxTextDeltaChars = Math.max(
            snapshot.maxTextDeltaChars,
            event.text.length,
          );
          break;
        }
        case "thinking_delta": {
          snapshot.thinkingDeltaCount += 1;
          break;
        }
        case "tool_start": {
          snapshot.toolStartCount += 1;
          snapshot.lastToolId = event.tool_id;
          snapshot.lastToolName = truncatePreview(event.tool_name);
          break;
        }
        case "tool_end": {
          snapshot.toolEndCount += 1;
          snapshot.lastToolId = event.tool_id;
          snapshot.maxToolOutputChars = Math.max(
            snapshot.maxToolOutputChars,
            event.result.output.length,
          );
          break;
        }
        case "action_required": {
          snapshot.actionRequiredCount += 1;
          break;
        }
        case "context_trace": {
          snapshot.contextTraceCount += 1;
          snapshot.maxContextTraceSteps = Math.max(
            snapshot.maxContextTraceSteps,
            event.steps.length,
          );
          break;
        }
        case "warning": {
          snapshot.warningCount += 1;
          snapshot.lastWarningCode = event.code;
          snapshot.lastErrorMessage = truncatePreview(event.message);
          publish(true);
          return;
        }
        case "done": {
          snapshot.doneCount += 1;
          publish(true);
          return;
        }
        case "final_done": {
          snapshot.finalDoneCount += 1;
          snapshot.state = "done";
          publish(true);
          return;
        }
        case "error": {
          snapshot.errorCount += 1;
          snapshot.state = "error";
          snapshot.lastErrorMessage = truncatePreview(event.message);
          publish(true);
          return;
        }
      }

      publish(false);
    },

    markError(message: string) {
      if (!snapshot) return;
      snapshot.state = "error";
      snapshot.lastEventAt = nowIso();
      snapshot.lastEventType = "error";
      snapshot.lastErrorMessage = truncatePreview(message);
      publish(true);
    },

    markDone() {
      if (!snapshot) return;
      snapshot.state = "done";
      snapshot.lastEventAt = nowIso();
      publish(true);
    },

    getSnapshot(): StreamDiagnosticsSnapshot | null {
      return snapshot ? { ...snapshot } : null;
    },
  };
}
