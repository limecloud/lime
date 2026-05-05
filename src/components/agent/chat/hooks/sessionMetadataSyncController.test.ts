import { describe, expect, it, vi } from "vitest";
import {
  buildSessionMetadataSyncPlan,
  buildSessionSwitchSuccessMetricContext,
  executeSessionMetadataSync,
  resolveSessionExecutionStrategySource,
} from "./sessionMetadataSyncController";

describe("sessionMetadataSyncController", () => {
  it("runtime accessMode 与 runtime preference 不应生成回填 patch", () => {
    const plan = buildSessionMetadataSyncPlan({
      runtimeAccessMode: "current",
      runtimePreference: {
        providerType: "deepseek",
        model: "deepseek-chat",
      },
      shadowAccessMode: "full-access",
      topicPreference: {
        providerType: "openai",
        model: "gpt-5",
      },
      workspaceDefaultAccessMode: "read-only",
    });

    expect(plan).toMatchObject({
      accessMode: "current",
      accessModeSource: "execution_runtime",
      fallbackExecutionStrategy: null,
      fallbackProviderPreference: null,
      hasPatch: false,
      modelPreferenceSource: "execution_runtime",
      patch: {},
      providerPreferenceToApply: {
        providerType: "openai",
        model: "gpt-5",
      },
      shouldPersistAccessMode: true,
    });
  });

  it("session storage fallback 应生成 accessMode 与 provider patch", () => {
    const plan = buildSessionMetadataSyncPlan({
      runtimeAccessMode: null,
      runtimePreference: null,
      shadowAccessMode: "full-access",
      shadowExecutionStrategyFallback: "code_orchestrated",
      topicPreference: {
        providerType: "openai",
        model: "gpt-5",
      },
      workspaceDefaultAccessMode: "read-only",
    });

    expect(plan).toMatchObject({
      accessMode: "full-access",
      accessModeSource: "session_storage",
      fallbackExecutionStrategy: "code_orchestrated",
      fallbackProviderPreference: {
        providerType: "openai",
        model: "gpt-5",
      },
      hasPatch: true,
      modelPreferenceSource: "session_storage",
      patch: {
        accessMode: "full-access",
        providerType: "openai",
        model: "gpt-5",
        executionStrategy: "code_orchestrated",
      },
      shouldPersistAccessMode: false,
    });
  });

  it("缺少 session accessMode 时应使用 workspace default 并生成 patch", () => {
    const plan = buildSessionMetadataSyncPlan({
      runtimeAccessMode: null,
      runtimePreference: null,
      shadowAccessMode: null,
      topicPreference: null,
      workspaceDefaultAccessMode: "read-only",
    });

    expect(plan).toMatchObject({
      accessMode: "read-only",
      accessModeSource: "workspace_default",
      hasPatch: true,
      patch: {
        accessMode: "read-only",
      },
      shouldPersistAccessMode: true,
    });
  });

  it("应稳定构造 switch success metric context 与 execution strategy source", () => {
    expect(
      resolveSessionExecutionStrategySource({
        runtimeExecutionStrategy: null,
        topicExecutionStrategy: null,
        shadowExecutionStrategyFallback: "react",
      }),
    ).toBe("shadow_cache");
    expect(
      buildSessionSwitchSuccessMetricContext({
        accessModeSource: "workspace_default",
        durationMs: 120,
        executionStrategySource: "shadow_cache",
        itemsCount: 3,
        messagesCount: 4,
        modelPreferenceSource: null,
        queuedTurnsCount: 1,
        topicId: "topic-a",
        turnsCount: 2,
        workspaceId: "workspace-a",
      }),
    ).toEqual({
      accessModeSource: "workspace_default",
      durationMs: 120,
      executionStrategySource: "shadow_cache",
      itemsCount: 3,
      messagesCount: 4,
      modelPreferenceSource: null,
      queuedTurnsCount: 1,
      sessionId: "topic-a",
      topicId: "topic-a",
      turnsCount: 2,
      workspaceId: "workspace-a",
    });
  });

  it("优先使用批量 updateSessionMetadata", async () => {
    const runtime = {
      updateSessionMetadata: vi.fn().mockResolvedValue(undefined),
      setSessionAccessMode: vi.fn(),
      setSessionExecutionStrategy: vi.fn(),
      setSessionProviderSelection: vi.fn(),
    };

    await executeSessionMetadataSync({
      fallbackExecutionStrategy: "react",
      fallbackProviderPreference: {
        providerType: "openai",
        model: "gpt-5",
      },
      patch: {
        accessMode: "current",
        providerType: "openai",
        model: "gpt-5",
        executionStrategy: "react",
      },
      runtime,
      sessionId: "topic-a",
    });

    expect(runtime.updateSessionMetadata).toHaveBeenCalledWith("topic-a", {
      accessMode: "current",
      providerType: "openai",
      model: "gpt-5",
      executionStrategy: "react",
    });
    expect(runtime.setSessionAccessMode).not.toHaveBeenCalled();
    expect(runtime.setSessionProviderSelection).not.toHaveBeenCalled();
    expect(runtime.setSessionExecutionStrategy).not.toHaveBeenCalled();
  });

  it("缺少批量命令时应回退到分散 metadata 命令", async () => {
    const runtime = {
      setSessionAccessMode: vi.fn().mockResolvedValue(undefined),
      setSessionExecutionStrategy: vi.fn().mockResolvedValue(undefined),
      setSessionProviderSelection: vi.fn().mockResolvedValue(undefined),
    };

    await executeSessionMetadataSync({
      fallbackExecutionStrategy: "code_orchestrated",
      fallbackProviderPreference: {
        providerType: "deepseek",
        model: "deepseek-chat",
      },
      patch: {
        accessMode: "full-access",
        providerType: "deepseek",
        model: "deepseek-chat",
        executionStrategy: "code_orchestrated",
      },
      runtime,
      sessionId: "topic-a",
    });

    expect(runtime.setSessionAccessMode).toHaveBeenCalledWith(
      "topic-a",
      "full-access",
    );
    expect(runtime.setSessionProviderSelection).toHaveBeenCalledWith(
      "topic-a",
      "deepseek",
      "deepseek-chat",
    );
    expect(runtime.setSessionExecutionStrategy).toHaveBeenCalledWith(
      "topic-a",
      "code_orchestrated",
    );
  });
});
