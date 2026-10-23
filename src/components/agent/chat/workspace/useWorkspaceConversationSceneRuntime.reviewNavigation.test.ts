import { expect, it, vi } from "vitest";
import {
  createBaseParams,
  getRenderedSceneProps,
} from "./useWorkspaceConversationSceneRuntime.testFixtures";
const api = vi.hoisted(() => ({ startReview: vi.fn() }));
vi.mock("@/lib/api/review", () => api);

it.each(["thread-parent", "thread-review-child"])(
  "opens the returned review Thread only when detached: %s",
  async (reviewThreadId) => {
    api.startReview.mockResolvedValue({
      reviewThreadId,
      turn: { id: "review-turn" },
    });
    const onOpenSubagentSession = vi.fn();
    const onRefreshSessionReadModel = vi.fn();
    const base = createBaseParams({
      threadRead: {
        thread_id: "thread-parent",
        file_checkpoint_summary: { count: 1 },
        artifacts: [
          {
            artifactRef: "artifact-file",
            eventId: "event-file",
            sequence: 1,
            turnId: "turn-parent",
            path: "index.ts",
            title: "index.ts",
            kind: "code_file",
            status: "completed",
            metadata: { previewText: "export {}" },
          },
        ],
      },
    });
    const scene = getRenderedSceneProps({
      ...base,
      messageListRuntime: {
        ...base.messageListRuntime,
        onOpenSubagentSession,
        onRefreshSessionReadModel,
      },
    });
    const start = scene.canvasWorkbenchLayoutProps.changeView?.onStartReview;
    expect(start).toBeTypeOf("function");
    await start!();
    expect(api.startReview).toHaveBeenCalledWith(
      { threadId: "thread-parent", target: { type: "uncommittedChanges" } },
      expect.any(Object),
    );
    if (reviewThreadId === "thread-parent")
      expect(onOpenSubagentSession).not.toHaveBeenCalled();
    else
      expect(onOpenSubagentSession).toHaveBeenCalledWith("thread-review-child");
  },
);
