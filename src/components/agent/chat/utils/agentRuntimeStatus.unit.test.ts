import { beforeEach, describe, expect, it } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";

import {
  buildFailedAgentMessageContent,
  buildFailedAgentRuntimeStatus,
  buildInitialAgentRuntimeStatus,
  buildWaitingAgentRuntimeStatus,
} from "./agentRuntimeStatus";

describe("agentRuntimeStatus", () => {
  beforeEach(async () => {
    await changeLimeLocale("zh-CN");
  });

  it("失败恢复展示原始错误，不追加风格前缀", () => {
    expect(buildFailedAgentMessageContent("provider failed")).toBe(
      "provider failed",
    );
  });




  it("等待只呈现实际阶段，不附带风格和检查点", () => {
    const initial = buildInitialAgentRuntimeStatus({ executionStrategy: "react" });
    const waiting = buildWaitingAgentRuntimeStatus({ executionStrategy: "react" });
    expect(initial).toMatchObject({ phase: "preparing", title: "正在准备", detail: "" });
    expect(waiting).toMatchObject({ phase: "routing", title: "正在处理", detail: "" });
    expect(initial.checkpoints).toBeUndefined();
    expect(Object.keys(initial.metadata ?? {})).not.toContain("soul_copy");
    expect(buildFailedAgentRuntimeStatus("provider failed").detail).toBe("provider failed");
  });
});
