import { describe, expect, it, vi } from "vitest";
import type { AppServerEventBus } from "../appServerEventBus";
import { AppServerServerRequestDispatcher } from "../appServerServerRequest";
import type { AppServerJsonRpcNotification } from "../appServerTypes";
import { projectAppServerAgentEventPayload } from "./appServerEventStreamProjection";
import { PendingInteractionController } from "./pendingInteractionController";

describe("server request resolution and conversation notifications", () => {
  it.each([42, "42"])(
    "settles only the matching pending request without a protocol warning (%s)",
    async (requestId) => {
      let subscription:
        | Parameters<AppServerEventBus["subscribe"]>[0]
        | undefined;
      const responder = {
        respondServerRequest: vi.fn(async () => undefined),
        rejectServerRequest: vi.fn(async () => undefined),
      };
      const dispatcher = new AppServerServerRequestDispatcher(responder, {
        subscribe(next) {
          subscription = next;
          return () => {
            subscription = undefined;
          };
        },
      });
      const controller = new PendingInteractionController(dispatcher);
      const detach = controller.attach();
      const dispatch = (threadId: string) =>
        dispatcher.dispatch({
          id: requestId,
          method: "item/commandExecution/requestApproval",
          params: {
            threadId,
            turnId: "turn-1",
            itemId: "item-1",
            approvalId: "approval-1",
            command: "browser history",
          },
        });
      const notify = (notification: AppServerJsonRpcNotification) => {
        subscription?.onNotifications?.([notification]);
        return projectAppServerAgentEventPayload(notification);
      };
      const ownRequest = dispatch("thread-1");
      const otherRequest = dispatch("thread-2");
      try {
        expect(controller.getSnapshot()).toHaveLength(2);
        const ownInteraction = controller
          .getSnapshot()
          .find((entry) => entry.thread_id === "thread-1")!;
        notify({
          method: "serverRequest/resolved",
          params: { threadId: "foreign-thread", requestId },
        });
        notify({
          method: "serverRequest/resolved",
          params: {
            threadId: "thread-1",
            requestId: typeof requestId === "number" ? "42" : 42,
          },
        });
        expect(controller.getSnapshot()).toHaveLength(2);

        const resolved: AppServerJsonRpcNotification = {
          method: "serverRequest/resolved",
          params: { threadId: "thread-1", requestId },
        };
        const projected = notify(resolved);
        await expect(ownRequest).resolves.toBe(false);
        expect(controller.getSnapshot()).toEqual([
          expect.objectContaining({ thread_id: "thread-2", status: "pending" }),
        ]);
        expect(
          controller.respond({
            interactionId: ownInteraction.id,
            kind: "approval",
            response: {
              requestId: "approval-1",
              actionType: "tool_confirmation",
              confirmed: true,
            },
          }).accepted,
        ).toBe(false);
        expect(notify(resolved)).toBeNull();
        expect(projected).toBeNull();
        expect(responder.respondServerRequest).not.toHaveBeenCalled();
        expect(responder.rejectServerRequest).not.toHaveBeenCalled();
      } finally {
        detach();
        dispatcher.reset();
        await Promise.all([ownRequest, otherRequest]);
      }
    },
  );

  it("still surfaces a truly unknown thread notification", () => {
    expect(
      projectAppServerAgentEventPayload({
        method: "serverRequest/unknown",
        params: { threadId: "thread-1", requestId: 42 },
      }),
    ).toMatchObject({
      type: "warning",
      code: "unknown_app_server_notification:serverRequest/unknown",
      thread_id: "thread-1",
    });
  });
});
