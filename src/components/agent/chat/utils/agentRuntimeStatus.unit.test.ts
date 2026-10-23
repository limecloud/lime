import { beforeEach, describe, expect, it } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { resolveSoulInteractionCopy } from "@/lib/soul/interactionCopy";
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

  it("默认失败恢复文案保持中性前缀", () => {
    expect(buildFailedAgentMessageContent("provider failed")).toBe(
      "执行失败：provider failed",
    );
  });

  it("失败恢复文案保持 neutral，并携带 memory.soul descriptor metadata", () => {
    const copy = resolveSoulInteractionCopy({
      soul: {
        enabled: true,
        style_profile_id: "cheeky_sassy_executor",
      },
    });

    expect(
      buildFailedAgentMessageContent("provider failed", undefined, copy),
    ).toBe("执行失败：provider failed");
    expect(buildFailedAgentRuntimeStatus("provider failed", copy)).toMatchObject({
      metadata: {
        soul_surface: "failure_recovery",
        soul_phase: "failed",
        style_level: "L2",
        risk_level: "normal",
        tone_variant: "cheeky_sassy",
        profile_id: "cheeky_sassy_executor",
        pack_id: "com.lime.soul.cheeky-sassy-executor",
      },
    });
  });

  it("初始和等待运行态保持 neutral，并携带 memory.soul descriptor metadata", () => {
    const copy = resolveSoulInteractionCopy({
      soul: {
        enabled: true,
        style_profile_id: "cheeky_sassy_executor",
      },
    });

    expect(
      buildInitialAgentRuntimeStatus({
        executionStrategy: "react",
        soulCopy: copy,
      }),
    ).toMatchObject({
      title: "正在准备处理",
      detail: "正在理解你的需求并准备当前阶段。",
      metadata: {
        soul_surface: "initial_runtime_status",
        soul_phase: "preparing",
        style_level: "L1",
        risk_level: "normal",
        tone_variant: "cheeky_sassy",
        profile_id: "cheeky_sassy_executor",
        pack_id: "com.lime.soul.cheeky-sassy-executor",
      },
    });
    expect(
      buildWaitingAgentRuntimeStatus({
        executionStrategy: "react",
        soulCopy: copy,
      }),
    ).toMatchObject({
      title: "正在启动处理流程",
      detail: "已开始处理，正在准备环境并等待第一条进展。",
      metadata: {
        soul_surface: "waiting_runtime_status",
        soul_phase: "routing",
        style_level: "L1",
        risk_level: "normal",
        tone_variant: "cheeky_sassy",
        profile_id: "cheeky_sassy_executor",
        pack_id: "com.lime.soul.cheeky-sassy-executor",
      },
    });
  });
});
