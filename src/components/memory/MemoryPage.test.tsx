import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupMountedRoots,
  flushEffects,
  renderIntoDom,
  setReactActEnvironment,
  type MountedRoot,
} from "@/components/image-gen/test-utils";
import { MemoryPage } from "./MemoryPage";

const {
  mockGetConfig,
  mockSaveConfig,
  mockGetContextMemoryOverview,
  mockGetProjectMemory,
  mockGetUnifiedMemoryStats,
  mockListUnifiedMemories,
  mockBuildLayerMetrics,
} = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockSaveConfig: vi.fn(),
  mockGetContextMemoryOverview: vi.fn(),
  mockGetProjectMemory: vi.fn(),
  mockGetUnifiedMemoryStats: vi.fn(),
  mockListUnifiedMemories: vi.fn(),
  mockBuildLayerMetrics: vi.fn(),
}));

vi.mock("@/lib/api/appConfig", () => ({
  getConfig: mockGetConfig,
  saveConfig: mockSaveConfig,
}));

vi.mock("@/lib/api/memoryRuntime", () => ({
  getContextMemoryOverview: mockGetContextMemoryOverview,
}));

vi.mock("@/lib/api/memory", () => ({
  createCharacter: vi.fn(),
  createOutlineNode: vi.fn(),
  getProjectMemory: mockGetProjectMemory,
  updateWorldBuilding: vi.fn(),
}));

vi.mock("@/lib/api/unifiedMemory", () => ({
  analyzeUnifiedMemories: vi.fn(),
  deleteUnifiedMemory: vi.fn(),
  getUnifiedMemoryStats: mockGetUnifiedMemoryStats,
  listUnifiedMemories: mockListUnifiedMemories,
}));

vi.mock("@/lib/resourceProjectSelection", () => ({
  getStoredResourceProjectId: vi.fn(() => null),
  onResourceProjectChange: vi.fn(() => () => {}),
}));

vi.mock("@/lib/workspace/navigation", () => ({
  buildClawAgentParams: vi.fn(() => ({ agentEntry: "claw" })),
  buildHomeAgentParams: vi.fn(() => ({ agentEntry: "home" })),
}));

vi.mock("@/lib/workspace/workbenchUi", () => ({
  CanvasBreadcrumbHeader: ({ label }: { label: string }) => <div>{label}</div>,
}));

vi.mock("./memoryLayerMetrics", () => ({
  buildLayerMetrics: (...args: unknown[]) => mockBuildLayerMetrics(...args),
}));

const mountedRoots: MountedRoot[] = [];

function renderPage() {
  return renderIntoDom(
    <MemoryPage onNavigate={vi.fn()} pageParams={{ section: "home" }} />,
    mountedRoots,
  ).container;
}

function getBodyText() {
  return document.body.textContent ?? "";
}

async function flushPageEffects(times = 4) {
  for (let index = 0; index < times; index += 1) {
    await flushEffects();
  }
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

describe("MemoryPage", () => {
  beforeEach(() => {
    setReactActEnvironment();
    vi.clearAllMocks();

    mockGetConfig.mockResolvedValue({
      memory: {
        enabled: true,
        max_entries: 1000,
        retention_days: 30,
        auto_cleanup: true,
      },
    });
    mockGetContextMemoryOverview.mockResolvedValue({
      stats: { total_entries: 0 },
    });
    mockGetProjectMemory.mockResolvedValue(null);
    mockGetUnifiedMemoryStats.mockResolvedValue({
      total_entries: 0,
      storage_used: 0,
      memory_count: 0,
      categories: [],
    });
    mockListUnifiedMemories.mockResolvedValue([]);
    mockBuildLayerMetrics.mockReturnValue({
      readyLayers: 1,
      totalLayers: 3,
      cards: [
        {
          key: "unified",
          title: "统一记忆",
          value: 0,
          unit: "条",
          available: true,
          description: "真实数据库已接通。",
        },
        {
          key: "context",
          title: "上下文记忆",
          value: 0,
          unit: "条",
          available: false,
          description: "等待更多上下文。",
        },
        {
          key: "project",
          title: "项目记忆",
          value: 0,
          unit: "/4 维",
          available: false,
          description: "暂未加载。",
        },
      ],
    });
  });

  afterEach(() => {
    cleanupMountedRoots(mountedRoots);
  });

  it("应把灵感库导航说明和总览说明收进 tips", async () => {
    renderPage();
    await flushPageEffects();

    expect(getBodyText()).not.toContain("按 / 搜索，按 1-6 切换视图。");
    expect(getBodyText()).not.toContain("查看已沉淀的风格、参考、成果与偏好");

    const navTip = await hoverTip("灵感库导航说明");
    expect(getBodyText()).toContain("按 / 搜索，按 1-6 切换视图。");
    await leaveTip(navTip);

    const heroTip = await hoverTip("灵感总览说明");
    expect(getBodyText()).toContain("查看已沉淀的风格、参考、成果与偏好");
    await leaveTip(heroTip);
  });
});
