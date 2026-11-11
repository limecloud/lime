import {
  mountedRoots,
  renderInputbar,
  expectInputbarSend,
  mockInputbarCore,
} from "./Inputbar.testFixtures";
import { Inputbar } from "./index";
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { describe, expect, it, vi } from "vitest";

import { changeLimeLocale } from "@/i18n/createI18n";
import { toast } from "sonner";

import { acceptedSubmission } from "../../hooks/agentSendResult.testFixtures";

describe("Inputbar controls current integration", () => {
  it("存在 executionRuntime 时底栏也应直接显示模型切换器", async () => {
    const { container } = renderInputbar({
      providerType: "openai",
      setProviderType: vi.fn(),
      model: "gpt-5.4-mini",
      setModel: vi.fn(),
      executionRuntime: {
        session_id: "session-1",
        provider_selector: "openai",
        provider_name: "openai",
        model_name: "gpt-5.4",
        source: "turn_context",
        output_schema_runtime: {
          source: "turn",
          strategy: "native",
          providerName: "openai",
          modelName: "gpt-5.4",
        },
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("最近执行模型");
    expect(
      container.querySelector('[data-testid="model-selector"]'),
    ).toBeTruthy();
    expect(container.textContent).not.toContain("结构化输出");
    expect(container.textContent).not.toContain("Native schema");
  });

  it("高级设置只保留权限模式，不再渲染编程执行前置开关", async () => {
    const setAccessMode = vi.fn();
    const { container } = renderInputbar({
      accessMode: "current",
      setAccessMode,
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="inputbar-plan-toggle"]'),
    ).toBeNull();
    expect(
      container.querySelector('select[aria-label="权限模式"]'),
    ).toBeTruthy();

    const planToggle = container.querySelector(
      '[data-testid="inputbar-plan-toggle"]',
    ) as HTMLButtonElement | null;
    const accessSelect = container.querySelector(
      'select[aria-label="权限模式"]',
    ) as HTMLSelectElement | null;

    expect(planToggle).toBeNull();
    expect(accessSelect).toBeTruthy();
    expect(container.querySelector('select[aria-label="执行模式"]')).toBeNull();
    expect(container.textContent).not.toContain("编程执行");

    act(() => {
      accessSelect!.value = "full-access";
      accessSelect?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(setAccessMode).toHaveBeenCalledWith("full-access");
  });

  it("高级设置 en-US 也不再渲染编程执行前置开关", async () => {
    await changeLimeLocale("en-US");
    const { container } = renderInputbar({
      accessMode: "current",
      setAccessMode: vi.fn(),
    });

    await act(async () => {
      await Promise.resolve();
    });

    const planToggle = container.querySelector(
      '[data-testid="inputbar-plan-toggle"]',
    ) as HTMLButtonElement | null;

    expect(planToggle).toBeNull();
    expect(container.textContent).not.toContain("Code");
    expect(container.textContent).not.toContain("coding execution");
  });

  it("禁用权限选择时只保留一层权限文案", async () => {
    const { container } = renderInputbar({
      isLoading: true,
      disabled: true,
      accessMode: "full-access",
      setAccessMode: vi.fn(),
    });

    await act(async () => {
      await Promise.resolve();
    });

    const select = container.querySelector(
      '[data-testid="inputbar-access-mode-select"]',
    ) as HTMLSelectElement;
    const label = select.closest("label")!;

    expect(select.disabled).toBe(true);
    expect(select.value).toBe("full-access");
    expect(label.querySelectorAll("[data-access-mode-label]")).toHaveLength(1);
  });

  it("受控模式下不再渲染联网搜索前置开关", async () => {
    const onToolStatesChange = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <Inputbar
          input=""
          setInput={vi.fn()}
          onSend={vi.fn()}
          isLoading={false}
          skills={[]}
          toolStates={{ subagent: false }}
          onToolStatesChange={onToolStatesChange}
        />,
      );
    });

    mountedRoots.push({ root, container });
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="toggle-web-search"]'),
    ).toBeNull();

    const toggleButton = container.querySelector(
      '[data-testid="toggle-web-search"]',
    ) as HTMLButtonElement | null;
    expect(toggleButton).toBeNull();
    expect(onToolStatesChange).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalledWith("联网搜索已开启");
  });

  it("en-US 下也不再渲染联网搜索前置开关", async () => {
    await changeLimeLocale("en-US");
    const onToolStatesChange = vi.fn();
    const { container } = renderInputbar({
      input: "please search the web",
      toolStates: { subagent: false },
      onToolStatesChange,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const toggleButton = container.querySelector(
      '[data-testid="toggle-web-search"]',
    ) as HTMLButtonElement | null;
    expect(toggleButton).toBeNull();
    expect(onToolStatesChange).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalledWith("Web search is on");
  });

  it("移除执行策略选择后普通发送不再提交 execution strategy", async () => {
    const onSend = vi.fn().mockResolvedValue(acceptedSubmission());
    const { container } = renderInputbar({
      input: "请联网检查这个依赖变更并修复编译错误",
      onSend,
      toolStates: { subagent: false },
    });

    await act(async () => {
      await Promise.resolve();
    });

    const sendButton = container.querySelector(
      '[data-testid="send-btn"]',
    ) as HTMLButtonElement | null;
    expect(sendButton).toBeTruthy();

    await act(async () => {
      sendButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expectInputbarSend(onSend, {
      textOverride: "请联网检查这个依赖变更并修复编译错误",
    });
  });

  it("通用聊天态复杂任务不再主动显示 Subagents 建议", async () => {
    const onToolStatesChange = vi.fn();
    const { container } = renderInputbar({
      input:
        "请拆分这个多代理调试任务，分别分析、实现、验证，再由主线程汇总结论。",
      activeTheme: "general",
      toolStates: { subagent: false },
      onToolStatesChange,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const retiredSuggestionTestId = ["team", "suggestion", "bar"].join("-");
    const suggestionBar = container.querySelector(
      `[data-testid="${retiredSuggestionTestId}"]`,
    );
    expect(suggestionBar).toBeNull();
    expect(onToolStatesChange).not.toHaveBeenCalled();
  });

  it("复杂任务但未开启 Subagents 时，不再渲染主动推荐入口", async () => {
    const { container } = renderInputbar({
      activeTheme: "general",
      input: "请把这个跨模块问题拆分成分析、实现、验证三个并行子任务再汇总",
      toolStates: { subagent: false },
    });

    await act(async () => {
      await Promise.resolve();
    });

    const recommendationButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("打开 Subagents"));

    expect(
      container.querySelector('[data-testid="team-mode-enable-button"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="toggle-subagent-mode"]'),
    ).toBeNull();
    expect(recommendationButton).toBeUndefined();
    const retiredSuggestionTestId = ["team", "suggestion", "bar"].join("-");
    const suggestionBar = container.querySelector(
      `[data-testid="${retiredSuggestionTestId}"]`,
    );
    expect(suggestionBar).toBeNull();
  });

  it("内容主题默认发送时不应再注入旧 skill 前缀", async () => {
    const onSend = vi.fn();
    const { container } = renderInputbar({
      activeTheme: "general",
      input: "写一篇春季上新种草文案",
      onSend,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const sendButton = container.querySelector(
      '[data-testid="send-btn"]',
    ) as HTMLButtonElement | null;
    expect(sendButton).toBeTruthy();

    await act(async () => {
      sendButton?.click();
      await Promise.resolve();
    });

    expectInputbarSend(onSend, {
      textOverride: "写一篇春季上新种草文案",
    });
  });

  it("社媒主题输入 slash 命令时不应重复注入默认 skill", async () => {
    const onSend = vi.fn();
    const { container } = renderInputbar({
      activeTheme: "general",
      input: "/custom_skill 写一篇品牌故事",
      onSend,
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const sendButton = container.querySelector(
      '[data-testid="send-btn"]',
    ) as HTMLButtonElement | null;
    expect(sendButton).toBeTruthy();

    await act(async () => {
      sendButton?.click();
      await Promise.resolve();
    });

    expectInputbarSend(onSend, {
      textOverride: "/custom_skill 写一篇品牌故事",
    });
  });

  it("工作区输入复用当前 Composer 槽位与提示文案", async () => {
    renderInputbar({
      variant: "workspace",
      providerType: "openai",
      setProviderType: vi.fn(),
      model: "gpt-4.1",
      setModel: vi.fn(),
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const latestCall =
      mockInputbarCore.mock.calls[mockInputbarCore.mock.calls.length - 1]?.[0];
    expect(latestCall).toBeTruthy();
    expect(
      Object.prototype.hasOwnProperty.call(latestCall, "showTranslate"),
    ).toBe(false);
    expect(latestCall.placeholder).toContain("试着输入任何指令");
    expect(latestCall.leftExtra).toBeUndefined();
  });

  it("已选择 Provider 时不应再将 prompt cache 提示组件常驻挂到输入区顶部", async () => {
    const { container } = renderInputbar({
      providerType: "custom-provider-id",
      setProviderType: vi.fn(),
      model: "glm-5.1",
      setModel: vi.fn(),
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="inputbar-prompt-cache-warning"]'),
    ).toBeNull();
  });

  it("生成工作区应使用继续推进型输入提示", async () => {
    renderInputbar({
      variant: "workspace",
      contextVariant: "task-center",
      providerType: "openai",
      setProviderType: vi.fn(),
      model: "gpt-4.1",
      setModel: vi.fn(),
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const latestCall =
      mockInputbarCore.mock.calls[mockInputbarCore.mock.calls.length - 1]?.[0];
    expect(latestCall).toBeTruthy();
    expect(latestCall.placeholder).toContain(
      "继续补充这轮生成，或回到左侧继续旧历史",
    );
  });

  it("工作区输入提示应跟随 en-US 资源", async () => {
    await changeLimeLocale("en-US");
    const { rerender } = renderInputbar({
      variant: "workspace",
      providerType: "openai",
      setProviderType: vi.fn(),
      model: "gpt-4.1",
      setModel: vi.fn(),
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    let latestCall =
      mockInputbarCore.mock.calls[mockInputbarCore.mock.calls.length - 1]?.[0];
    expect(latestCall?.placeholder).toBe(
      "Try entering any instruction and I will handle the rest.",
    );

    rerender({
      variant: "workspace",
      contextVariant: "task-center",
      providerType: "openai",
      setProviderType: vi.fn(),
      model: "gpt-4.1",
      setModel: vi.fn(),
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    latestCall =
      mockInputbarCore.mock.calls[mockInputbarCore.mock.calls.length - 1]?.[0];
    expect(latestCall?.placeholder).toBe(
      "Keep adding to this generation, or use the left side to return to earlier history.",
    );

    rerender({
      variant: "workspace",
      workflowGate: {
        key: "review_choice",
        title: "Review choice",
        status: "waiting",
        description: "Choose how to continue.",
      },
      providerType: "openai",
      setProviderType: vi.fn(),
      model: "gpt-4.1",
      setModel: vi.fn(),
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    latestCall =
      mockInputbarCore.mock.calls[mockInputbarCore.mock.calls.length - 1]?.[0];
    expect(latestCall?.placeholder).toBe(
      "Tell me your choice and I will handle the rest.",
    );
  });
});
