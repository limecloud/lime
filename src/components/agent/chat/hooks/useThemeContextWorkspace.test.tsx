import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useThemeContextWorkspace,
  type ThemeContextWorkspaceState,
} from "./useThemeContextWorkspace";
import type { Message } from "../types";

const mockListContents = vi.hoisted(() => vi.fn());
const mockGetContent = vi.hoisted(() => vi.fn());
const mockSearchThemeContextWithWebSearch = vi.hoisted(() => vi.fn());
const mockUseMaterials = vi.hoisted(() => vi.fn());
const mockIsSpecializedWorkbenchTheme = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/project", () => ({
  listContents: mockListContents,
  getContent: mockGetContent,
}));

vi.mock("@/hooks/useMaterials", () => ({
  useMaterials: mockUseMaterials,
}));

vi.mock("@/lib/workspace/workbenchContract", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/workspace/workbenchContract")>();
  return {
    ...actual,
    isSpecializedWorkbenchTheme: mockIsSpecializedWorkbenchTheme,
  };
});

vi.mock("../utils/contextSearch", () => ({
  searchThemeContextWithWebSearch: mockSearchThemeContextWithWebSearch,
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  sessionStorage.clear();
  mockListContents.mockResolvedValue([]);
  mockGetContent.mockResolvedValue({ body: "" });
  mockSearchThemeContextWithWebSearch.mockResolvedValue({
    title: "默认搜索上下文",
    summary: "默认搜索摘要",
    citations: [],
    rawResponse:
      '{"title":"默认搜索上下文","summary":"默认搜索摘要","citations":[]}',
  });
  mockUseMaterials.mockReturnValue({
    materials: [],
    getContent: vi.fn().mockResolvedValue(""),
  });
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) break;
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  sessionStorage.clear();
});

interface ProbeProps {
  projectId?: string;
  activeTheme: string;
  messages: Message[];
  providerType?: string;
  model?: string;
  onSnapshot: (value: ThemeContextWorkspaceState) => void;
}

function Probe({
  projectId,
  activeTheme,
  messages,
  providerType = "openai",
  model = "gpt-4o-mini",
  onSnapshot,
}: ProbeProps) {
  const state = useThemeContextWorkspace({
    projectId,
    activeTheme,
    messages,
    providerType,
    model,
  });
  onSnapshot(state);
  return null;
}

async function flushEffects(times = 8) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function mountProbe(props: ProbeProps) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });
  act(() => {
    root.render(<Probe {...props} />);
  });
}

describe("useThemeContextWorkspace", () => {
  it("非主题模式应禁用工作台上下文", async () => {
    mockIsSpecializedWorkbenchTheme.mockReturnValue(false);
    let snapshot: ThemeContextWorkspaceState | null = null;

    mountProbe({
      projectId: "project-a",
      activeTheme: "general",
      messages: [],
      onSnapshot: (value) => {
        snapshot = value;
      },
    });
    await flushEffects();

    expect(snapshot!.generalWorkbenchEnabled).toBe(false);
    expect(snapshot!.enabled).toBe(false);
    expect(snapshot!.sidebarContextItems).toEqual([]);
    expect(snapshot!.activeContextPrompt).toBe("");
  });

  it("主题模式应自动加载 Top3 上下文并生成日志快照", async () => {
    mockIsSpecializedWorkbenchTheme.mockReturnValue(true);
    mockUseMaterials.mockReturnValue({
      materials: [
        { id: "m1", name: "素材1", description: "desc", tags: ["a"] },
        { id: "m2", name: "素材2", description: "desc", tags: ["b"] },
      ],
      getContent: vi.fn().mockResolvedValue("素材正文"),
    });
    mockListContents.mockResolvedValue([
      {
        id: "c1",
        title: "历史稿1",
        content_type: "article",
        status: "done",
      },
    ]);

    const messages: Message[] = [
      {
        id: "msg-1",
        role: "assistant",
        content: "",
        timestamp: new Date("2026-03-05T10:30:00.000Z"),
        toolCalls: [
          {
            id: "tool-1",
            name: "research",
            status: "completed",
            startTime: new Date("2026-03-05T10:30:00.000Z"),
            endTime: new Date("2026-03-05T10:30:01.500Z"),
          },
        ],
      },
    ];

    let snapshot: ThemeContextWorkspaceState | null = null;
    mountProbe({
      projectId: "project-b",
      activeTheme: "general",
      messages,
      onSnapshot: (value) => {
        snapshot = value;
      },
    });
    await flushEffects(12);

    expect(snapshot!.generalWorkbenchEnabled).toBe(true);
    expect(snapshot!.enabled).toBe(true);
    expect(snapshot!.contextBudget.activeCount).toBe(3);
    expect(snapshot!.activeContextPrompt).toContain("[生效上下文]");
    expect(snapshot!.activityLogs[0]?.name).toBe("research");
    expect((snapshot!.activityLogs[0]?.contextIds?.length || 0) > 0).toBe(true);
    expect(snapshot!.activityLogs[0]?.messageId).toBe("msg-1");
  });

  it("历史内容同标题应仅保留最新一条", async () => {
    mockIsSpecializedWorkbenchTheme.mockReturnValue(true);
    mockListContents.mockResolvedValue([
      {
        id: "content-old",
        project_id: "project-dup-content",
        title: "新帖子",
        content_type: "post",
        status: "draft",
        order: 1,
        word_count: 0,
        created_at: 1700000000000,
        updated_at: 1700000000000,
      },
      {
        id: "content-new",
        project_id: "project-dup-content",
        title: "新帖子",
        content_type: "post",
        status: "draft",
        order: 2,
        word_count: 0,
        created_at: 1700000100000,
        updated_at: 1700000200000,
      },
      {
        id: "content-other",
        project_id: "project-dup-content",
        title: "选题池",
        content_type: "post",
        status: "draft",
        order: 3,
        word_count: 0,
        created_at: 1700000300000,
        updated_at: 1700000400000,
      },
    ]);

    let snapshot: ThemeContextWorkspaceState | null = null;
    mountProbe({
      projectId: "project-dup-content",
      activeTheme: "general",
      messages: [],
      onSnapshot: (value) => {
        snapshot = value;
      },
    });
    await flushEffects(12);

    const contentItems = snapshot!.sidebarContextItems.filter(
      (item) => item.source === "content",
    );
    const sameTitleItems = contentItems.filter(
      (item) => item.name === "新帖子",
    );

    expect(sameTitleItems).toHaveLength(1);
    expect(sameTitleItems[0]?.id).toBe("content:content-new");
    expect(contentItems.map((item) => item.id)).toEqual(
      expect.arrayContaining(["content:content-new", "content:content-other"]),
    );
  });

  it("应支持联网搜索生成上下文并自动激活", async () => {
    mockIsSpecializedWorkbenchTheme.mockReturnValue(true);
    mockSearchThemeContextWithWebSearch.mockResolvedValue({
      title: "智能体泡沫观察",
      summary:
        "2026 年市场对智能体基建和应用进入分化阶段，讨论聚焦落地成本、场景ROI与平台生态。",
      citations: [{ title: "官方博客", url: "https://example.com/blog" }],
      rawResponse:
        '{"title":"智能体泡沫观察","summary":"2026 年市场对智能体基建和应用进入分化阶段，讨论聚焦落地成本、场景ROI与平台生态。","citations":[{"title":"官方博客","url":"https://example.com/blog"}]}',
    });

    let snapshot: ThemeContextWorkspaceState | null = null;
    mountProbe({
      projectId: "project-search",
      activeTheme: "general",
      messages: [],
      onSnapshot: (value) => {
        snapshot = value;
      },
    });
    await flushEffects(10);

    act(() => {
      snapshot!.setContextSearchQuery("智能体泡沫 2026");
    });
    await flushEffects(4);

    await act(async () => {
      await snapshot!.submitContextSearch();
    });
    await flushEffects(8);

    expect(mockSearchThemeContextWithWebSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "project-search",
        projectId: "project-search",
        query: "智能体泡沫 2026",
        mode: "web",
      }),
    );
    expect(snapshot!.contextSearchQuery).toBe("");
    expect(snapshot!.sidebarContextItems[0]?.source).toBe("search");
    expect(snapshot!.sidebarContextItems[0]?.active).toBe(true);
    expect(snapshot!.sidebarContextItems[0]?.previewText).toContain(
      "2026 年市场",
    );
    expect(snapshot!.sidebarContextItems[0]?.citations?.[0]?.url).toBe(
      "https://example.com/blog",
    );
    expect(snapshot!.activeContextPrompt).toContain("智能体泡沫观察");
    expect(snapshot!.activeContextPrompt).toContain("https://example.com/blog");
  });

  it("prepareActiveContextPrompt 应加载本地正文并拼入提示词", async () => {
    mockIsSpecializedWorkbenchTheme.mockReturnValue(true);
    const mockMaterialGetContent = vi
      .fn()
      .mockResolvedValue("品牌手册正文，包含品牌定位、目标人群和传播语气。");
    mockUseMaterials.mockReturnValue({
      materials: [
        { id: "m1", name: "品牌手册", description: "品牌资产", tags: [] },
      ],
      getContent: mockMaterialGetContent,
    });

    let snapshot: ThemeContextWorkspaceState | null = null;
    mountProbe({
      projectId: "project-material",
      activeTheme: "general",
      messages: [],
      onSnapshot: (value) => {
        snapshot = value;
      },
    });
    await flushEffects(10);

    const prompt = await snapshot!.prepareActiveContextPrompt();

    expect(mockMaterialGetContent).toHaveBeenCalledWith("m1");
    expect(prompt).toContain("品牌手册");
    expect(prompt).toContain("品牌手册正文");
  });

  it("应兼容序列化后的时间字符串并正确格式化耗时", async () => {
    mockIsSpecializedWorkbenchTheme.mockReturnValue(true);
    mockUseMaterials.mockReturnValue({
      materials: [{ id: "m1", name: "素材1", description: "desc", tags: [] }],
      getContent: vi.fn().mockResolvedValue("素材正文"),
    });
    mockListContents.mockResolvedValue([]);

    const messages = [
      {
        id: "msg-2",
        role: "assistant",
        content: "",
        timestamp: "2026-03-05T10:30:00.000Z",
        toolCalls: [
          {
            id: "tool-2",
            name: "typesetting",
            status: "completed",
            startTime: "2026-03-05T10:30:00.000Z",
            endTime: "2026-03-05T10:30:01.500Z",
          },
        ],
      },
    ] as unknown as Message[];

    let snapshot: ThemeContextWorkspaceState | null = null;
    mountProbe({
      projectId: "project-c",
      activeTheme: "general",
      messages,
      onSnapshot: (value) => {
        snapshot = value;
      },
    });
    await flushEffects(12);

    expect(snapshot!.activityLogs[0]?.durationLabel).toBe("1.5s");
    expect(snapshot!.activityLogs[0]?.timeLabel).not.toBe("--:--");
  });

  it("应从工具参数与输出提取修改产物路径", async () => {
    mockIsSpecializedWorkbenchTheme.mockReturnValue(true);

    const messages = [
      {
        id: "msg-3",
        role: "assistant",
        content: "",
        timestamp: "2026-03-05T10:40:00.000Z",
        toolCalls: [
          {
            id: "tool-3",
            name: "write_file",
            status: "completed",
            arguments: JSON.stringify({
              file_path: "content-posts/demo.md",
            }),
            result: {
              success: true,
              output: JSON.stringify({
                artifact_paths: [
                  "content-posts/demo.md",
                  "content-posts/demo.publish-pack.json",
                ],
              }),
            },
            startTime: "2026-03-05T10:40:00.000Z",
            endTime: "2026-03-05T10:40:01.000Z",
          },
        ],
      },
    ] as unknown as Message[];

    let snapshot: ThemeContextWorkspaceState | null = null;
    mountProbe({
      projectId: "project-artifact-path",
      activeTheme: "general",
      messages,
      onSnapshot: (value) => {
        snapshot = value;
      },
    });
    await flushEffects(12);

    expect(snapshot!.activityLogs[0]?.artifactPaths).toEqual([
      "content-posts/demo.md",
      "content-posts/demo.publish-pack.json",
    ]);
  });

  it("应递归提取嵌套协议对象中的产物路径", async () => {
    mockIsSpecializedWorkbenchTheme.mockReturnValue(true);

    const messages = [
      {
        id: "msg-4",
        role: "assistant",
        content: "",
        timestamp: "2026-03-05T10:50:00.000Z",
        toolCalls: [
          {
            id: "tool-4",
            name: "typesetting",
            status: "completed",
            arguments: JSON.stringify({
              payload: {
                filePath: "content-posts/draft.md",
              },
            }),
            result: {
              success: true,
              output: JSON.stringify({
                result: {
                  absolute_path: "/tmp/content-posts/final.md",
                },
              }),
            },
            startTime: "2026-03-05T10:50:00.000Z",
            endTime: "2026-03-05T10:50:01.000Z",
          },
        ],
      },
    ] as unknown as Message[];

    let snapshot: ThemeContextWorkspaceState | null = null;
    mountProbe({
      projectId: "project-artifact-nested-path",
      activeTheme: "general",
      messages,
      onSnapshot: (value) => {
        snapshot = value;
      },
    });
    await flushEffects(12);

    expect(snapshot!.activityLogs[0]?.artifactPaths).toEqual([
      "content-posts/draft.md",
      "/tmp/content-posts/final.md",
    ]);
  });
});
