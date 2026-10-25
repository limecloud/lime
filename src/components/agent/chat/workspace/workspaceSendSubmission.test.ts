import { describe, expect, it, vi } from "vitest";
import {
  submitWorkspaceMessage,
  withWorkspaceSubmissionCleanup,
} from "./workspaceSendSubmission";
const receipt = {
  kind: "steer" as const,
  sessionId: "actual-session",
  threadId: "thread-1",
  turnId: "turn-1",
};
describe("Workspace typed submission boundary", () => {
  it("settles early observer then retains acceptance when refresh wrapper throws", async () => {
    const onRuntimeAccepted = vi.fn();
    const onRejected = vi.fn();
    const result = await submitWorkspaceMessage({
      observer: { onRuntimeAccepted },
      onRejected,
      submit: async (observer) => {
        observer.onRuntimeAccepted?.(receipt);
        throw new Error("read model failed");
      },
    });
    expect(result).toEqual({ kind: "runtime-accepted", receipt });
    expect(onRuntimeAccepted).toHaveBeenCalledOnce();
    expect(onRejected).not.toHaveBeenCalled();
  });
  it("postaccepted finalization error does not withdraw accepted result", async () => {
    expect(
      await submitWorkspaceMessage({
        submit: async () => ({ kind: "runtime-accepted", receipt }),
        onAccepted: () => {
          throw new Error("PRIVATE POST BODY");
        },
      }),
    ).toEqual({ kind: "runtime-accepted", receipt });
  });
  it.each([
    { kind: "local-handled" as const },
    { kind: "unknown" as const },
    { kind: "rejected" as const },
  ])("does not finalize nonaccepted %j", async (result) => {
    const onAccepted = vi.fn();
    expect(
      await submitWorkspaceMessage({ submit: async () => result, onAccepted }),
    ).toEqual(result);
    expect(onAccepted).not.toHaveBeenCalled();
  });
  it("keeps original rejected error despite failing UI diagnostic", async () => {
    const error = new Error("runtime rejected");
    const onRejected = vi.fn(() => {
      throw new Error("UI error");
    });
    expect(
      await submitWorkspaceMessage({
        submit: async () => {
          throw error;
        },
        onRejected,
      }),
    ).toEqual({ kind: "rejected", error });
    expect(onRejected).toHaveBeenCalledWith(error);
  });
});

describe("accepted cleanup identity", () => {
  it("cleanup throw retains accepted result", async () => {
    const result = { kind: "runtime-accepted" as const, receipt };
    expect(
      await withWorkspaceSubmissionCleanup(
        async () => result,
        () => {
          throw new Error("PRIVATE CLEANUP BODY");
        },
      ),
    ).toEqual(result);
  });
  it("cleanup throw cannot mask original request rejection", async () => {
    const original = new Error("runtime rejected");
    await expect(
      withWorkspaceSubmissionCleanup(
        async () => {
          throw original;
        },
        () => {
          throw new Error("cleanup");
        },
      ),
    ).rejects.toBe(original);
  });
});
