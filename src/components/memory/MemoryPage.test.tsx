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
  mockGetStoredResourceProjectId,
  mockOnResourceProjectChange,
  mockBuildHomeAgentParams,
} = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockSaveConfig: vi.fn(),
  mockGetContextMemoryOverview: vi.fn(),
  mockGetProjectMemory: vi.fn(),
  mockGetUnifiedMemoryStats: vi.fn(),
  mockListUnifiedMemories: vi.fn(),
  mockBuildLayerMetrics: vi.fn(),
  mockGetStoredResourceProjectId: vi.fn(),
  mockOnResourceProjectChange: vi.fn(),
  mockBuildHomeAgentParams: vi.fn(),
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
  getStoredResourceProjectId: mockGetStoredResourceProjectId,
  onResourceProjectChange: mockOnResourceProjectChange,
}));

vi.mock("@/lib/workspace/navigation", () => ({
  buildClawAgentParams: vi.fn(() => ({ agentEntry: "claw" })),
  buildHomeAgentParams: mockBuildHomeAgentParams,
}));

vi.mock("@/lib/workspace/workbenchUi", () => ({
  CanvasBreadcrumbHeader: ({ label }: { label: string }) => <div>{label}</div>,
}));

vi.mock("./memoryLayerMetrics", () => ({
  buildLayerMetrics: (...args: unknown[]) => mockBuildLayerMetrics(...args),
}));

const mountedRoots: MountedRoot[] = [];

function renderPage(options?: {
  onNavigate?: (page: string, params?: unknown) => void;
}) {
  return renderIntoDom(
    <MemoryPage
      onNavigate={options?.onNavigate}
      pageParams={{ section: "home" }}
    />,
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
    mockGetStoredResourceProjectId.mockReturnValue(null);
    mockOnResourceProjectChange.mockReturnValue(() => {});
    mockGetUnifiedMemoryStats.mockResolvedValue({
      total_entries: 0,
      storage_used: 0,
      memory_count: 0,
      categories: [],
    });
    mockListUnifiedMemories.mockResolvedValue([]);
    mockBuildHomeAgentParams.mockImplementation((overrides = {}) => ({
      agentEntry: "new-task",
      ...overrides,
    }));
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

  it("应支持把选中的灵感条目带回创作输入", async () => {
    const onNavigate = vi.fn();
    mockGetStoredResourceProjectId.mockReturnValue("project-42");
    mockGetUnifiedMemoryStats.mockResolvedValue({
      total_entries: 1,
      storage_used: 1024,
      memory_count: 1,
      categories: [{ category: "identity", count: 1 }],
    });
    mockListUnifiedMemories.mockResolvedValue([
      {
        id: "memory-1",
        session_id: "session-1",
        memory_type: "conversation",
        category: "identity",
        title: "夏日短视频语气",
        summary: "适合清爽、轻快、有镜头感的小红书口播开场。",
        content:
          "第一句先给画面感，再抛出反差点，整体节奏要短句、轻快、有停顿。",
        updated_at: 1_712_345_678_900,
        created_at: 1_712_300_000_000,
        tags: ["小红书", "口播", "夏日氛围"],
        metadata: {
          source: "auto_extracted",
        },
      },
    ]);

    renderPage({ onNavigate });
    await flushPageEffects();

    const bringToCreationButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("带回创作输入"));
    expect(bringToCreationButton).toBeTruthy();

    await act(async () => {
      bringToCreationButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(mockBuildHomeAgentParams).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-42",
        entryBannerMessage: "已从灵感库带入“风格”条目，可继续改写后发送。",
        initialUserPrompt: expect.stringContaining("灵感标题：夏日短视频语气"),
        initialRequestMetadata: {
          harness: {
            creation_replay: expect.objectContaining({
              kind: "memory_entry",
              source: expect.objectContaining({
                page: "memory",
                project_id: "project-42",
                entry_id: "memory-1",
              }),
              data: expect.objectContaining({
                category: "identity",
                title: "夏日短视频语气",
                tags: ["小红书", "口播", "夏日氛围"],
              }),
            }),
          },
        },
      }),
    );
    expect(onNavigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        agentEntry: "new-task",
        projectId: "project-42",
        entryBannerMessage: "已从灵感库带入“风格”条目，可继续改写后发送。",
        initialUserPrompt: expect.stringContaining("标签：小红书、口播、夏日氛围"),
        initialRequestMetadata: {
          harness: {
            creation_replay: expect.objectContaining({
              kind: "memory_entry",
            }),
          },
        },
      }),
    );
  });
});
