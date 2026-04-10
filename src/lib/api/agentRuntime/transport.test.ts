import { describe, expect, it, vi } from "vitest";
import {
  createAgentRuntimeBridgeInvoke,
  createAgentRuntimeCommandInvoke,
} from "./transport";

describe("agentRuntime transport", () => {
  it("无 payload 时应直接透传命令名", async () => {
    const invoke = vi.fn().mockResolvedValueOnce({ ok: true });
    const bridgeInvoke = createAgentRuntimeBridgeInvoke({ invoke });

    await expect(bridgeInvoke("agent_get_process_status")).resolves.toEqual({
      ok: true,
    });

    expect(invoke).toHaveBeenCalledWith("agent_get_process_status");
  });

  it("有 payload 时应透传命令名与请求体", async () => {
    const invoke = vi.fn().mockResolvedValueOnce({ success: true });
    const bridgeInvoke = createAgentRuntimeBridgeInvoke({ invoke });

    await expect(
      bridgeInvoke("site_run_adapter", {
        request: { adapter: "x/article-export" },
      }),
    ).resolves.toEqual({ success: true });

    expect(invoke).toHaveBeenCalledWith("site_run_adapter", {
      request: { adapter: "x/article-export" },
    });
  });

  it("默认注入缺失时也应返回可调用函数", () => {
    const bridgeInvoke = createAgentRuntimeBridgeInvoke();
    expect(bridgeInvoke).toBeTypeOf("function");
  });

  it("command invoker 应复用自定义 bridgeInvoke", async () => {
    const bridgeInvoke = vi.fn().mockResolvedValueOnce({ ok: true });
    const invokeCommand = createAgentRuntimeCommandInvoke({ bridgeInvoke });

    await expect(invokeCommand("agent_runtime_list_sessions")).resolves.toEqual({
      ok: true,
    });

    expect(bridgeInvoke).toHaveBeenCalledWith("agent_runtime_list_sessions");
  });
});
