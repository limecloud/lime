import { afterEach, describe, expect, it } from "vitest";
import { clearAgentUiPerformanceMetrics } from "@/lib/agentUiPerformanceMetrics";
import {
  clearConversationProjectionDiagnostics,
  conversationProjectionStore,
  selectLatestConversationStreamDiagnostic,
} from "../projection/conversationProjectionStore";
import {
  extractAgentUiPerformanceTraceMetadata,
  mergeAgentUiPerformanceTraceMetadata,
  recordAgentStreamPerformanceMetric,
} from "./agentStreamPerformanceMetrics";

describe("agentStreamPerformanceMetrics", () => {
  afterEach(() => {
    clearAgentUiPerformanceMetrics();
    clearConversationProjectionDiagnostics();
  });

  it("记录现有性能指标时应同步写入 Conversation Projection Store", () => {
    const trace = {
      requestId: "request-stream-a",
      sessionId: "draft-session-a",
      workspaceId: "workspace-a",
      source: "home-input",
      submittedAt: Date.now(),
    };

    const entry = recordAgentStreamPerformanceMetric(
      "agentStream.firstTextDelta",
      trace,
      {
        sessionId: "runtime-session-a",
        deltaLength: 8,
      },
    );

    const projection = selectLatestConversationStreamDiagnostic(
      conversationProjectionStore.getSnapshot(),
      "draft-session-a",
    );
    expect(projection).toMatchObject({
      phase: "agentStream.firstTextDelta",
      sessionId: "draft-session-a",
      workspaceId: "workspace-a",
      source: "home-input",
      requestId: "request-stream-a",
      actualSessionId: "runtime-session-a",
      metrics: {
        deltaLength: 8,
        requestId: "request-stream-a",
        actualSessionId: "runtime-session-a",
      },
    });
    expect(projection?.at).toBe(entry.at);
  });

  it("合并 trace metadata 后应可从 requestMetadata 继续记录 projection", () => {
    const requestMetadata = mergeAgentUiPerformanceTraceMetadata(undefined, {
      requestId: "request-stream-b",
      sessionId: "draft-session-b",
      workspaceId: "workspace-b",
      source: "test",
      submittedAt: null,
    });

    recordAgentStreamPerformanceMetric(
      "agentStream.submitAccepted",
      extractAgentUiPerformanceTraceMetadata(requestMetadata),
      {
        accepted: true,
      },
    );

    expect(
      selectLatestConversationStreamDiagnostic(
        conversationProjectionStore.getSnapshot(),
        "draft-session-b",
      ),
    ).toMatchObject({
      phase: "agentStream.submitAccepted",
      requestId: "request-stream-b",
      metrics: {
        accepted: true,
      },
    });
  });
});
