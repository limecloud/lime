import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetConfig,
  mockSaveConfig,
  mockGetMemoryEffectiveSources,
  mockGetMemoryExtractionStatus,
  mockGetMemoryAutoIndex,
  mockGetWorkingMemory,
  mockEnsureWorkspaceLocalAgentsGitignore,
  mockScaffoldRuntimeAgentsTemplate,
  mockToggleMemoryAuto,
  mockUpdateMemoryAutoNote,
  mockGetUnifiedMemoryStats,
} = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockSaveConfig: vi.fn(),
  mockGetMemoryEffectiveSources: vi.fn(),
  mockGetMemoryExtractionStatus: vi.fn(),
  mockGetMemoryAutoIndex: vi.fn(),
  mockGetWorkingMemory: vi.fn(),
  mockEnsureWorkspaceLocalAgentsGitignore: vi.fn(),
  mockScaffoldRuntimeAgentsTemplate: vi.fn(),
  mockToggleMemoryAuto: vi.fn(),
  mockUpdateMemoryAutoNote: vi.fn(),
  mockGetUnifiedMemoryStats: vi.fn(),
}));

vi.mock("@/lib/api/appConfig", () => ({
  getConfig: mockGetConfig,
  saveConfig: mockSaveConfig,
}));

vi.mock("@/lib/api/memoryRuntime", () => ({
  getContextMemoryEffectiveSources: mockGetMemoryEffectiveSources,
  getContextMemoryExtractionStatus: mockGetMemoryExtractionStatus,
  getContextMemoryAutoIndex: mockGetMemoryAutoIndex,
  getContextWorkingMemory: mockGetWorkingMemory,
  ensureWorkspaceLocalAgentsGitignore: mockEnsureWorkspaceLocalAgentsGitignore,
  scaffoldRuntimeAgentsTemplate: mockScaffoldRuntimeAgentsTemplate,
  toggleContextMemoryAuto: mockToggleMemoryAuto,
  updateContextMemoryAutoNote: mockUpdateMemoryAutoNote,
}));

vi.mock("@/lib/api/unifiedMemory", () => ({
  getUnifiedMemoryStats: mockGetUnifiedMemoryStats,
}));

vi.mock("@/components/memory/memoryLayerMetrics", () => ({
  buildLayerMetrics: vi.fn(() => ({
    cards: [
      {
        key: "rules",
        title: "规则层",
        value: 1,
        unit: "源",
        available: true,
        description: "ok",
      },
      {
        key: "working",
        title: "工作记忆",
        value: 0,
        unit: "条",
        available: false,
        description: "wait",
      },
      {
        key: "durable",
        title: "长期记忆",
        value: 0,
        unit: "条",
        available: false,
        description: "wait",
      },
      {
        key: "team",
        title: "Team 影子",
        value: 0,
        unit: "份",
        available: false,
        description: "wait",
      },
      {
        key: "compaction",
        title: "压缩边界",
        value: 0,
        unit: "次",
        available: false,
        description: "wait",
      },
    ],
    readyLayers: 1,
    totalLayers: 5,
  })),
}));

import { MemorySettings } from ".";

interface Mounted {
  container: HTMLDivElement;
  root: Root;
}

const mounted: Mounted[] = [];

function renderComponent(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<MemorySettings />);
  });
  mounted.push({ container, root });
  return container;
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const buttons = Array.from(container.querySelectorAll("button"));
  const matched = buttons.find((button) => button.textContent?.includes(text));
  if (!matched) {
    throw new Error(`未找到按钮: ${text}`);
  }
  return matched as HTMLButtonElement;
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

function getBodyText() {
  return document.body.textContent ?? "";
}

async function hoverTip(ariaLabel: string) {
  const trigger = document.body.querySelector(
    `button[aria-label='${ariaLabel}']`,
  );
  expect(trigger).toBeInstanceOf(HTMLButtonElement);

  await act(async () => {
    trigger?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await Promise.resolve();
  });

  return trigger as HTMLButtonElement;
}

async function leaveTip(trigger: HTMLButtonElement | null) {
  await act(async () => {
    trigger?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    await Promise.resolve();
  });
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  vi.clearAllMocks();

  mockGetConfig.mockResolvedValue({
    memory: {
      enabled: true,
      max_entries: 1000,
      retention_days: 30,
      auto_cleanup: true,
      profile: {
        strengths: [],
        explanation_style: [],
        challenge_preference: [],
      },
      auto: {
        enabled: true,
        entrypoint: "MEMORY.md",
        max_loaded_lines: 200,
      },
      resolve: {
        additional_dirs: [],
        follow_imports: true,
        import_max_depth: 5,
        load_additional_dirs_memory: false,
      },
      sources: {
        project_memory_paths: ["AGENTS.md"],
        project_rule_dirs: [".agents/rules"],
        user_memory_path: undefined,
      },
    },
  });

  mockGetUnifiedMemoryStats.mockResolvedValue({ total_entries: 1 });
  mockGetMemoryEffectiveSources.mockResolvedValue({
    working_dir: "/tmp",
    total_sources: 2,
    loaded_sources: 1,
    follow_imports: true,
    import_max_depth: 5,
    sources: [],
  });
  mockGetMemoryExtractionStatus.mockResolvedValue({
    enabled: true,
    status: "ready",
    status_summary: "工作记忆和上下文压缩快照都已就绪。",
    working_session_count: 1,
    working_entry_count: 2,
    latest_working_memory_at: 1_712_345_678_900,
    latest_compaction: null,
    recent_compactions: [],
  });
  mockGetWorkingMemory.mockResolvedValue({
    memory_dir: "/tmp/runtime/memory",
    total_sessions: 1,
    total_entries: 2,
    sessions: [],
  });
  mockGetMemoryAutoIndex.mockResolvedValue({
    enabled: true,
    root_dir: "/tmp/memory",
    entrypoint: "MEMORY.md",
    max_loaded_lines: 200,
    entry_exists: false,
    total_lines: 0,
    preview_lines: [],
    items: [],
  });
  mockToggleMemoryAuto.mockResolvedValue({ enabled: false });
  mockScaffoldRuntimeAgentsTemplate.mockResolvedValue({
    target: "workspace",
    path: "/tmp/.lime/AGENTS.md",
    status: "created",
    createdParentDir: true,
  });
  mockEnsureWorkspaceLocalAgentsGitignore.mockResolvedValue({
    path: "/tmp/.gitignore",
    entry: ".lime/AGENTS.local.md",
    status: "added",
  });
  mockUpdateMemoryAutoNote.mockResolvedValue({
    enabled: true,
    root_dir: "/tmp/memory",
    entrypoint: "MEMORY.md",
    max_loaded_lines: 200,
    entry_exists: true,
    total_lines: 1,
    preview_lines: ["- test"],
    items: [],
  });
});

afterEach(() => {
  while (mounted.length > 0) {
    const target = mounted.pop();
    if (!target) break;
    act(() => {
      target.root.unmount();
    });
    target.container.remove();
  }
  vi.clearAllTimers();
});

describe("MemorySettings", () => {
  it("应把首屏说明和问卷副标题收进 tips", async () => {
    renderComponent();
    await flushEffects();
    await flushEffects();

    expect(getBodyText()).not.toContain(
      "管理用户画像、五层记忆来源与自动记忆入口，让代理在长期使用里更稳定地续接规则、上下文与协作状态。",
    );
    expect(getBodyText()).not.toContain(
      "单选，用于帮助代理判断你的知识密度和上下文称呼。",
    );

    const heroTip = await hoverTip("记忆设置说明");
    expect(getBodyText()).toContain(
      "管理用户画像、五层记忆来源与自动记忆入口，让代理在长期使用里更稳定地续接规则、上下文与协作状态。",
    );
    await leaveTip(heroTip);

    const questionTip = await hoverTip("以下哪个选项最能形容你现在的状态?说明");
    expect(getBodyText()).toContain(
      "单选，用于帮助代理判断你的知识密度和上下文称呼。",
    );
    await leaveTip(questionTip);
  });

  it("应渲染新的记忆概览与主要分区", async () => {
    const container = renderComponent();
    await flushEffects();
    await flushEffects();

    const text = container.textContent ?? "";
    expect(text).toContain("记忆");
    expect(text).toContain("管理用户画像、来源策略与自动记忆入口。");
    expect(text).toContain("记忆总开关");
    expect(text).toContain("偏好画像");
    expect(text).toContain("五层记忆可用性");
    expect(text).toContain("记忆来源策略");
    expect(text).toContain("自动记忆（Auto Memory）");
  });

  it("初始化时应加载来源与自动记忆索引", async () => {
    renderComponent();
    await flushEffects();
    await flushEffects();

    expect(mockGetMemoryEffectiveSources).toHaveBeenCalledTimes(2);
    expect(mockGetMemoryAutoIndex).toHaveBeenCalledTimes(1);
  });

  it("点击立即关闭应调用 toggleContextMemoryAuto", async () => {
    const container = renderComponent();
    await flushEffects();
    await flushEffects();

    await act(async () => {
      findButton(container, "立即关闭").click();
    });

    expect(mockToggleMemoryAuto).toHaveBeenCalledWith(false);
  });

  it("未填写内容时写入自动记忆应阻止调用", async () => {
    const container = renderComponent();
    await flushEffects();
    await flushEffects();

    await act(async () => {
      findButton(container, "写入自动记忆").click();
    });
    await flushEffects();

    expect(mockUpdateMemoryAutoNote).not.toHaveBeenCalled();
    expect(container.textContent).toContain("请先输入要保存的自动记忆内容");
  });

  it("点击生成 Workspace 模板应调用模板生成 API", async () => {
    const container = renderComponent();
    await flushEffects();
    await flushEffects();

    await act(async () => {
      findButton(container, "生成 Workspace 模板").click();
    });

    expect(mockScaffoldRuntimeAgentsTemplate).toHaveBeenCalledWith(
      "workspace",
      "/tmp",
      false,
    );
  });

  it("点击加入 .gitignore 应调用 gitignore API", async () => {
    const container = renderComponent();
    await flushEffects();
    await flushEffects();

    await act(async () => {
      findButton(container, "将本机模板加入 .gitignore").click();
    });

    expect(mockEnsureWorkspaceLocalAgentsGitignore).toHaveBeenCalledWith(
      "/tmp",
    );
  });
});
