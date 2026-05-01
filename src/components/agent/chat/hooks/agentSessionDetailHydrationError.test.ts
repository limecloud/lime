import { describe, expect, it } from "vitest";
import {
  classifySessionDetailHydrationError,
  getSessionDetailHydrationErrorMessage,
} from "./agentSessionDetailHydrationError";

describe("agentSessionDetailHydrationError", () => {
  it("不应对 DevBridge 读超时立即重试", () => {
    expect(
      classifySessionDetailHydrationError(
        new Error(
          '[DevBridge] 浏览器模式无法连接后端桥接，命令 "agent_runtime_get_session" 执行失败。原始错误: Failed to fetch (timeout after 8000ms)',
        ),
      ),
    ).toEqual({
      category: "timeout",
      retryable: false,
      transient: true,
    });
  });

  it("健康检查失败可低优先级重试", () => {
    expect(
      classifySessionDetailHydrationError(
        new Error("Failed to fetch (bridge health check failed)"),
      ),
    ).toEqual({
      category: "bridge_health",
      retryable: true,
      transient: true,
    });
  });

  it("硬连接失败可低优先级重试", () => {
    expect(
      classifySessionDetailHydrationError(new Error("ERR_CONNECTION_REFUSED")),
    ).toEqual({
      category: "connection",
      retryable: true,
      transient: true,
    });
  });

  it("后端业务错误不按 DevBridge 瞬态错误处理", () => {
    expect(
      classifySessionDetailHydrationError(new Error("session not found")),
    ).toEqual({
      category: "unknown",
      retryable: false,
      transient: false,
    });
  });

  it("可读取非 Error 错误消息", () => {
    expect(
      getSessionDetailHydrationErrorMessage("bridge cooldown active"),
    ).toBe("bridge cooldown active");
  });
});
