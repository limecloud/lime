import { describe, expect, it } from "vitest";
import {
  buildSessionPostFinalizePersistencePlan,
  resolvePersistedSessionWorkspaceId,
  resolveSessionDetailTopicWorkspaceId,
} from "./sessionPostFinalizePersistenceController";

describe("sessionPostFinalizePersistenceController", () => {
  it("topic workspace 应按 runtime / known / resolved 顺序恢复", () => {
    expect(
      resolveSessionDetailTopicWorkspaceId({
        runtimeWorkspaceId: "runtime-workspace",
        knownWorkspaceId: "known-workspace",
        resolvedWorkspaceId: "resolved-workspace",
      }),
    ).toBe("runtime-workspace");

    expect(
      resolveSessionDetailTopicWorkspaceId({
        runtimeWorkspaceId: null,
        knownWorkspaceId: "known-workspace",
        resolvedWorkspaceId: "resolved-workspace",
      }),
    ).toBe("known-workspace");

    expect(
      resolveSessionDetailTopicWorkspaceId({
        runtimeWorkspaceId: null,
        knownWorkspaceId: null,
        resolvedWorkspaceId: "resolved-workspace",
      }),
    ).toBe("resolved-workspace");
  });

  it("持久化 workspace 只应使用 runtime workspace 或当前 resolved workspace", () => {
    expect(
      resolvePersistedSessionWorkspaceId({
        runtimeWorkspaceId: "runtime-workspace",
        resolvedWorkspaceId: "resolved-workspace",
      }),
    ).toBe("runtime-workspace");

    expect(
      resolvePersistedSessionWorkspaceId({
        runtimeWorkspaceId: null,
        resolvedWorkspaceId: "resolved-workspace",
      }),
    ).toBe("resolved-workspace");

    expect(
      resolvePersistedSessionWorkspaceId({
        runtimeWorkspaceId: null,
        resolvedWorkspaceId: null,
      }),
    ).toBeNull();
  });

  it("应构造 finalize 后 workspace 与 provider 持久化计划", () => {
    expect(
      buildSessionPostFinalizePersistencePlan({
        runtimeWorkspaceId: "runtime-workspace",
        knownWorkspaceId: "known-workspace",
        resolvedWorkspaceId: "resolved-workspace",
        providerPreferenceToApply: {
          providerType: "deepseek",
          model: "deepseek-chat",
        },
      }),
    ).toEqual({
      persistedWorkspaceId: "runtime-workspace",
      providerPreferenceToApply: {
        providerType: "deepseek",
        model: "deepseek-chat",
      },
      runtimeTopicWorkspaceIdToApply: "runtime-workspace",
      topicWorkspaceId: "runtime-workspace",
    });
  });
});
