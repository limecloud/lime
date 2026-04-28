import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupMountedRoots,
  flushEffects,
  renderIntoDom,
  setReactActEnvironment,
  type MountedRoot,
} from "@/components/image-gen/test-utils";
import {
  CURATED_TASK_RECOMMENDATION_SIGNAL_EVENT,
  recordCuratedTaskRecommendationSignalFromReviewDecision,
} from "@/components/agent/chat/utils/curatedTaskRecommendationSignals";
import { recordRuntimeMemoryPrefetchHistory } from "@/lib/runtimeMemoryPrefetchHistory";
import { MemoryPage } from "./MemoryPage";

const {
  mockGetConfig,
  mockSaveConfig,
  mockCleanupContextMemdir,
  mockGetContextMemoryEffectiveSources,
  mockGetContextMemoryAutoIndex,
  mockGetContextWorkingMemory,
  mockGetContextMemoryExtractionStatus,
  mockPrefetchContextMemoryForTurn,
  mockScaffoldContextMemdir,
  mockGetUnifiedMemoryStats,
  mockListUnifiedMemories,
  mockGetProjectMemory,
  mockGetStoredResourceProjectId,
  mockOnResourceProjectChange,
  mockBuildHomeAgentParams,
} = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockSaveConfig: vi.fn(),
  mockCleanupContextMemdir: vi.fn(),
  mockGetContextMemoryEffectiveSources: vi.fn(),
  mockGetContextMemoryAutoIndex: vi.fn(),
  mockGetContextWorkingMemory: vi.fn(),
  mockGetContextMemoryExtractionStatus: vi.fn(),
  mockPrefetchContextMemoryForTurn: vi.fn(),
  mockScaffoldContextMemdir: vi.fn(),
  mockGetUnifiedMemoryStats: vi.fn(),
  mockListUnifiedMemories: vi.fn(),
  mockGetProjectMemory: vi.fn(),
  mockGetStoredResourceProjectId: vi.fn(),
  mockOnResourceProjectChange: vi.fn(),
  mockBuildHomeAgentParams: vi.fn(),
}));

vi.mock("@/lib/api/appConfig", () => ({
  getConfig: mockGetConfig,
  saveConfig: mockSaveConfig,
}));

vi.mock("@/lib/api/memoryRuntime", () => ({
  cleanupContextMemdir: mockCleanupContextMemdir,
  getContextMemoryEffectiveSources: mockGetContextMemoryEffectiveSources,
  getContextMemoryAutoIndex: mockGetContextMemoryAutoIndex,
  getContextWorkingMemory: mockGetContextWorkingMemory,
  getContextMemoryExtractionStatus: mockGetContextMemoryExtractionStatus,
  prefetchContextMemoryForTurn: mockPrefetchContextMemoryForTurn,
  scaffoldContextMemdir: mockScaffoldContextMemdir,
}));

vi.mock("@/lib/api/unifiedMemory", () => ({
  getUnifiedMemoryStats: mockGetUnifiedMemoryStats,
  listUnifiedMemories: mockListUnifiedMemories,
}));

vi.mock("@/lib/api/memory", () => ({
  getProjectMemory: mockGetProjectMemory,
}));

vi.mock("@/lib/resourceProjectSelection", () => ({
  getStoredResourceProjectId: mockGetStoredResourceProjectId,
  onResourceProjectChange: mockOnResourceProjectChange,
}));

vi.mock("@/lib/workspace/navigation", () => ({
  buildHomeAgentParams: mockBuildHomeAgentParams,
}));

const mountedRoots: MountedRoot[] = [];

function renderPage(options?: {
  section?: "home" | "identity" | "rules" | "experience";
  onNavigate?: (page: string, params?: unknown) => void;
  focusMemoryTitle?: string;
  focusMemoryCategory?: "identity" | "context" | "preference" | "experience" | "activity";
  runtimeSessionId?: string;
  runtimeWorkingDir?: string;
  runtimeUserMessage?: string;
}) {
  return renderIntoDom(
    <MemoryPage
      onNavigate={options?.onNavigate || vi.fn()}
      pageParams={{
        section: options?.section || "home",
        focusMemoryTitle: options?.focusMemoryTitle,
        focusMemoryCategory: options?.focusMemoryCategory,
        runtimeSessionId: options?.runtimeSessionId,
        runtimeWorkingDir: options?.runtimeWorkingDir,
        runtimeUserMessage: options?.runtimeUserMessage,
      }}
    />,
    mountedRoots,
  ).container;
}

function updateFieldValue(
  element: HTMLInputElement | HTMLTextAreaElement | null,
  value: string,
) {
  expect(element).toBeTruthy();
  if (!element) {
    return;
  }

  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

async function flushPageEffects(times = 4) {
  for (let index = 0; index < times; index += 1) {
    await flushEffects();
  }
}

describe("MemoryPage", () => {
  beforeEach(() => {
    setReactActEnvironment();
    vi.clearAllMocks();
    window.localStorage.clear();

    mockGetConfig.mockResolvedValue({
      memory: {
        enabled: true,
        max_entries: 1000,
        retention_days: 30,
        auto_cleanup: true,
      },
    });
    mockGetContextMemoryEffectiveSources.mockResolvedValue({
      working_dir: "/tmp/workspace",
      total_sources: 2,
      loaded_sources: 1,
      follow_imports: true,
      import_max_depth: 5,
      sources: [
        {
          kind: "workspace_agents",
          source_bucket: "project",
          updated_at: 1_712_345_678_900,
          path: "/tmp/workspace/.lime/AGENTS.md",
          exists: true,
          loaded: true,
          line_count: 12,
          import_count: 0,
          warnings: [],
          preview: "# AGENTS\\n- 默认先跑 verify:local",
        },
      ],
    });
    mockGetContextMemoryAutoIndex.mockResolvedValue({
      enabled: true,
      root_dir: "/tmp/workspace/memory",
      entrypoint: "MEMORY.md",
      max_loaded_lines: 200,
      entry_exists: true,
      total_lines: 2,
      preview_lines: ["# MEMORY", "- mock note"],
      items: [
        {
          title: "项目记忆",
          memory_type: "project",
          provider: "memdir",
          updated_at: 1_712_345_678_900,
          relative_path: "project/README.md",
          exists: true,
          summary: "记录项目背景、时间点、约束和分工。",
        },
      ],
    });
    mockCleanupContextMemdir.mockResolvedValue({
      root_dir: "/tmp/workspace/memory",
      entrypoint: "MEMORY.md",
      scanned_files: 6,
      updated_files: 2,
      removed_duplicate_links: 1,
      dropped_missing_links: 1,
      removed_duplicate_notes: 1,
      trimmed_notes: 1,
      curated_topic_files: 1,
    });
    mockScaffoldContextMemdir.mockResolvedValue({
      root_dir: "/tmp/workspace/memory",
      entrypoint: "MEMORY.md",
      created_parent_dir: false,
      files: [
        {
          key: "entry",
          path: "/tmp/workspace/memory/MEMORY.md",
          status: "exists",
        },
      ],
    });
    mockGetContextWorkingMemory.mockResolvedValue({
      memory_dir: "/tmp/runtime/memory",
      total_sessions: 1,
      total_entries: 2,
      sessions: [
        {
          session_id: "session-1",
          total_entries: 2,
          updated_at: 1_712_345_678_900,
          files: [
            {
              file_type: "task_plan",
              path: "/tmp/runtime/memory/session-1/task_plan.md",
              exists: true,
              entry_count: 1,
              updated_at: 1_712_345_678_900,
              summary: "先补命令边界，再补页面。",
            },
          ],
          highlights: [],
        },
      ],
    });
    mockGetContextMemoryExtractionStatus.mockResolvedValue({
      enabled: true,
      status: "ready",
      status_summary: "工作记忆和上下文压缩快照都已就绪。",
      working_session_count: 1,
      working_entry_count: 2,
      latest_working_memory_at: 1_712_345_678_900,
      latest_compaction: {
        session_id: "session-1",
        source: "summary_cache",
        summary_preview: "这是最近一次压缩后的摘要。",
        turn_count: 8,
        created_at: 1_712_345_678_900,
      },
      recent_compactions: [
        {
          session_id: "session-1",
          source: "summary_cache",
          summary_preview: "这是最近一次压缩后的摘要。",
          turn_count: 8,
          created_at: 1_712_345_678_900,
        },
      ],
    });
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
    mockGetProjectMemory.mockResolvedValue({
      characters: [],
      world_building: null,
      outline: [],
    });
    mockGetStoredResourceProjectId.mockReturnValue("project-42");
    mockOnResourceProjectChange.mockReturnValue(() => {});
    mockBuildHomeAgentParams.mockImplementation((overrides = {}) => ({
      agentEntry: "new-task",
      ...overrides,
    }));
    mockPrefetchContextMemoryForTurn.mockResolvedValue({
      session_id: "session-default",
      rules_source_paths: [],
      working_memory_excerpt: null,
      durable_memories: [],
      team_memory_entries: [],
      latest_compaction: null,
      prompt: null,
    });
  });

  afterEach(() => {
    cleanupMountedRoots(mountedRoots);
  });

  it("应展示灵感库与底层诊断分层结构", async () => {
    renderPage();
    await flushPageEffects();

    expect(document.body.querySelector(".lime-workbench-theme-scope")).not.toBeNull();

    const bodyText = document.body.textContent ?? "";
    expect(bodyText).toContain("灵感库");
    expect(bodyText).toContain("灵感总览");
    expect(bodyText).toContain("底层来源");
    expect(bodyText).toContain("会话工作记忆");
    expect(bodyText).toContain("参考与风格");
    expect(bodyText).toContain("团队影子");
    expect(bodyText).toContain("压缩摘要");
    expect(bodyText).toContain("底层记忆目录与作用域");
    expect(bodyText).toContain("记忆目录（memdir）");
    expect(bodyText).toContain("底层记忆守则");
    expect(bodyText).not.toContain("Claude Code");
  });

  it("home 分区应展示灵感总览与风格层摘要", async () => {
    renderPage();
    await flushPageEffects();

    const bodyText = document.body.textContent ?? "";
    expect(bodyText).toContain("灵感库总览");
    expect(bodyText).toContain("围绕当前灵感，先拿结果");
    expect(bodyText).toContain("可继续复用的灵感对象");
    expect(bodyText).toContain("这次可带上的参考素材");
    expect(bodyText).toContain("系统已提炼的创作倾向");
    expect(bodyText).toContain("底层记忆只做事实源");
    expect(bodyText).toContain("1 条灵感对象");
    expect(bodyText).toContain("0 条参考素材");
    expect(bodyText).toContain("4 个风格关键词");
    expect(bodyText).toContain("1 条来源已接入");
    expect(bodyText).toContain("1 条参考对象");
    expect(bodyText).toContain("内容主稿生成");
    expect(bodyText).toContain("风格层摘要");
    expect(bodyText).toContain("夏日短视频语气");
  });

  it("应在灵感库首屏显式提供项目资料辅助入口", async () => {
    const onNavigate = vi.fn();
    renderPage({ onNavigate });
    await flushPageEffects();

    const callout = document.body.querySelector(
      '[data-testid="memory-project-resources-callout"]',
    ) as HTMLElement | null;
    expect(callout?.className).toContain("var(--lime-info-soft)");

    const bodyText = document.body.textContent ?? "";
    expect(bodyText).toContain("项目资料作为辅助页保留在这里");
    expect(bodyText).toContain(
      "默认资料导航现在优先看灵感库；需要回看项目资料、导入内容和外部资料时，从这里打开项目资料。",
    );
    expect(bodyText).toContain("打开项目资料");

    const openResourcesButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((element) => element.textContent?.includes("打开项目资料"));
    expect(openResourcesButton).toBeTruthy();

    await act(async () => {
      openResourcesButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onNavigate).toHaveBeenCalledWith("resources");
  });

  it("应支持从灵感库推荐结果模板进入共享 launcher，再带着参考对象进入生成", async () => {
    const onNavigate = vi.fn();
    renderPage({ onNavigate });
    await flushPageEffects();

    const launchButton = Array.from(document.body.querySelectorAll("button")).find(
      (element) =>
        element.textContent?.includes("开始这一步") &&
        element.closest("article")?.textContent?.includes("内容主稿生成"),
    );
    expect(launchButton).toBeTruthy();

    await act(async () => {
      launchButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await flushPageEffects();

    expect(document.body.textContent ?? "").toContain("开始这一步前，我先确认几件事。");
    expect(document.body.textContent ?? "").toContain("已选择 1 条参考对象");

    const subjectField = document.body.querySelector(
      'textarea[placeholder="输入主题、产品、活动或你已经掌握的关键信息"]',
    ) as HTMLTextAreaElement | null;
    const audienceField = document.body.querySelector(
      'input[placeholder="例如 25-35 岁新消费品牌运营，或 正在找 AI 剪辑工具的创作者"]',
    ) as HTMLInputElement | null;

    await act(async () => {
      updateFieldValue(subjectField, "夏日饮品新品上线，需要一版小红书首发主稿");
      updateFieldValue(audienceField, "喜欢轻快口播风格的小红书用户");
      await Promise.resolve();
    });

    const confirmButton = document.body.querySelector(
      '[data-testid="curated-task-launcher-confirm"]',
    ) as HTMLButtonElement | null;
    expect(confirmButton).toBeTruthy();

    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onNavigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        agentEntry: "new-task",
        projectId: "project-42",
        entryBannerMessage:
          "已带着灵感库推荐“内容主稿生成”的启动信息回到生成，接着把这轮做下去就行。",
        initialInputCapability: expect.objectContaining({
          capabilityRoute: expect.objectContaining({
            kind: "curated_task",
            taskId: "social-post-starter",
            taskTitle: "内容主稿生成",
            launchInputValues: {
              subject_or_product: "夏日饮品新品上线，需要一版小红书首发主稿",
              target_audience: "喜欢轻快口播风格的小红书用户",
            },
            referenceMemoryIds: ["memory-1"],
            referenceEntries: expect.arrayContaining([
              expect.objectContaining({
                id: "memory-1",
                title: "夏日短视频语气",
                category: "identity",
              }),
            ]),
          }),
        }),
        initialRequestMetadata: expect.objectContaining({
          harness: expect.objectContaining({
            curated_task: expect.objectContaining({
              task_id: "social-post-starter",
              reference_memory_ids: ["memory-1"],
            }),
            creation_replay: expect.objectContaining({
              kind: "memory_entry",
              source: expect.objectContaining({
                page: "memory",
                entry_id: "memory-1",
              }),
            }),
          }),
        }),
      }),
    );
  });

  it("灵感库 launcher 在当前模板不是复盘首选时，应可直接切到推荐模板且保留参考对象", async () => {
    recordCuratedTaskRecommendationSignalFromReviewDecision(
      {
        session_id: "session-memory-review-switch",
        decision_status: "needs_more_evidence",
        decision_summary: "这轮结果还缺证据，需要回到账号表现和爆款样本继续补证据。",
        chosen_fix_strategy: "先补账号数据复盘，再拆一轮高表现内容做对照。",
        risk_level: "medium",
        risk_tags: ["证据不足", "需要复盘"],
        followup_actions: ["补账号数据复盘", "拆解一条高表现内容"],
      },
      {
        projectId: "project-42",
        sceneTitle: "短视频编排",
      },
    );

    renderPage();
    await flushPageEffects();

    const launchButton = Array.from(document.body.querySelectorAll("button")).find(
      (element) => {
        if (!element.textContent?.includes("开始这一步")) {
          return false;
        }
        const articleText = element.closest("article")?.textContent ?? "";
        return (
          articleText.length > 0 &&
          !articleText.includes("复盘这个账号/项目") &&
          !articleText.includes("拆解一条爆款内容")
        );
      },
    );
    expect(launchButton).toBeTruthy();

    await act(async () => {
      launchButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await flushPageEffects();

    const actionButton = document.body.querySelector(
      '[data-testid="curated-task-launcher-review-feedback-banner-action"]',
    ) as HTMLButtonElement | null;
    expect(actionButton?.textContent).toContain("改用「复盘这个账号/项目」");

    await act(async () => {
      actionButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await flushPageEffects();

    const bodyText = document.body.textContent ?? "";
    expect(bodyText).toContain("复盘这个账号/项目");
    expect(bodyText).toContain("已按最近判断切到更适合的结果模板");
    expect(bodyText).toContain("已选择 1 条参考对象");
  });

  it("home 分区在存在成果条目时应显影当前续接成果，并优先推荐下一步", async () => {
    mockGetUnifiedMemoryStats.mockResolvedValue({
      total_entries: 2,
      storage_used: 2048,
      memory_count: 2,
      categories: [
        { category: "experience", count: 1 },
        { category: "identity", count: 1 },
      ],
    });
    mockListUnifiedMemories.mockResolvedValue([
      {
        id: "memory-2",
        session_id: "session-1",
        memory_type: "conversation",
        category: "experience",
        title: "短视频编排 · 复核阻塞",
        summary: "当前结果包已完整回流，可继续进入下一轮。",
        content: [
          "场景：短视频编排",
          "结果摘要：这轮内容已经产出一版完整结果包。",
          "当前交付：已交付 3/4 个部件",
          "建议下一步：先完成复核，再决定下一轮放量",
          "当前信号：复核阻塞",
        ].join("\n"),
        updated_at: 1_712_345_779_000,
        created_at: 1_712_345_700_000,
        tags: ["短视频", "复核阻塞"],
        metadata: {
          source: "manual",
        },
      },
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

    renderPage();
    await flushPageEffects();

    const bodyText = document.body.textContent ?? "";
    expect(bodyText).toContain("围绕当前灵感，先拿结果");
    expect(bodyText).toContain("当前续接成果");
    expect(bodyText).toContain("短视频编排 · 复核阻塞");
    expect(bodyText).toContain("复盘这个账号/项目");
    expect(bodyText).toContain("每日趋势摘要");
    expect(bodyText).toContain("内容主稿生成");
    expect(bodyText).toContain(
      "先对齐「短视频编排 · 复核阻塞」这轮结果基线，再决定下一轮动作",
    );
    expect(bodyText).toContain(
      "围绕「短视频编排 · 复核阻塞」这轮结果继续找趋势窗口",
    );

    const reviewCard = document.body.querySelector(
      '[data-testid="memory-home-suggestion-panel-task-account-project-review"]',
    ) as HTMLElement | null;
    const trendCard = document.body.querySelector(
      '[data-testid="memory-home-suggestion-panel-task-daily-trend-briefing"]',
    ) as HTMLElement | null;
    const socialCard = document.body.querySelector(
      '[data-testid="memory-home-suggestion-panel-task-social-post-starter"]',
    ) as HTMLElement | null;
    const longformCard = document.body.querySelector(
      '[data-testid="memory-home-suggestion-panel-task-longform-multiplatform-rewrite"]',
    ) as HTMLElement | null;

    expect(reviewCard?.textContent).toContain("围绕当前成果");
    expect(trendCard?.textContent).toContain("承接当前结果");
    expect(socialCard?.textContent).toContain("承接当前结果");
    expect(longformCard).toBeNull();
  });

  it("收到推荐信号后应页内刷新灵感库快照与推荐区参考对象", async () => {
    mockGetUnifiedMemoryStats
      .mockResolvedValueOnce({
        total_entries: 1,
        storage_used: 1024,
        memory_count: 1,
        categories: [{ category: "identity", count: 1 }],
      })
      .mockResolvedValueOnce({
        total_entries: 2,
        storage_used: 2048,
        memory_count: 2,
        categories: [
          { category: "identity", count: 1 },
          { category: "context", count: 1 },
        ],
      });
    mockListUnifiedMemories
      .mockResolvedValueOnce([
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
      ])
      .mockResolvedValueOnce([
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
        {
          id: "memory-2",
          session_id: "session-1",
          memory_type: "conversation",
          category: "context",
          title: "新品视觉参考板",
          summary: "更偏冷白背景、留白构图和产品近景。",
          content: "主画面保持干净，强调瓶身细节和冰感材质。",
          updated_at: 1_712_345_779_000,
          created_at: 1_712_345_700_000,
          tags: ["参考图", "冷白背景"],
          metadata: {
            source: "manual",
          },
        },
      ]);

    renderPage();
    await flushPageEffects();

    expect(document.body.textContent ?? "").toContain("0 条参考素材");
    expect(document.body.textContent ?? "").toContain("1 条参考对象");

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(CURATED_TASK_RECOMMENDATION_SIGNAL_EVENT),
      );
      await Promise.resolve();
    });
    await flushPageEffects(6);

    const bodyText = document.body.textContent ?? "";
    expect(mockGetUnifiedMemoryStats).toHaveBeenCalledTimes(2);
    expect(mockListUnifiedMemories).toHaveBeenCalledTimes(2);
    expect(bodyText).toContain("1 条参考素材");
    expect(bodyText).toContain("2 条参考对象");
    expect(bodyText).toContain("新品视觉参考板");
  });

  it("rules 分区应展示来源分类、provider 与 memdir 类型标签", async () => {
    mockGetContextMemoryEffectiveSources.mockResolvedValue({
      working_dir: "/tmp/workspace",
      total_sources: 3,
      loaded_sources: 2,
      follow_imports: true,
      import_max_depth: 5,
      sources: [
        {
          kind: "workspace_agents",
          source_bucket: "project",
          updated_at: 1_712_345_678_900,
          path: "/tmp/workspace/.lime/AGENTS.md",
          exists: true,
          loaded: true,
          line_count: 12,
          import_count: 0,
          warnings: [],
          preview: "# AGENTS\\n- 默认先跑 verify:local",
        },
        {
          kind: "auto_memory_item",
          source_bucket: "auto",
          provider: "memdir",
          memory_type: "feedback",
          updated_at: 1_712_345_678_900,
          path: "/tmp/workspace/memory/feedback/workflow.md",
          exists: true,
          loaded: true,
          line_count: 6,
          import_count: 0,
          warnings: [],
          preview: "Why:\\n- 团队反复确认 pnpm only。",
        },
      ],
    });

    renderPage({ section: "rules" });
    await flushPageEffects();

    const bodyText = document.body.textContent ?? "";
    expect(bodyText).toContain("底层记忆来源与 memdir");
    expect(bodyText).toContain("来源分类：记忆目录（memdir）");
    expect(bodyText).toContain("provider：memdir");
    expect(bodyText).toContain("反馈记忆");
    expect(bodyText).toContain("最近更新：");

    const previewBlock = Array.from(document.body.querySelectorAll("pre")).find(
      (element) => element.textContent?.includes("# AGENTS"),
    );
    expect(previewBlock).toBeTruthy();
    expect(previewBlock?.className).toContain("border-sky-100");
    expect(previewBlock?.className).not.toContain("bg-slate-950");
  });

  it("rules 分区应支持整理 memdir 并复用同一条治理能力", async () => {
    renderPage({ section: "rules" });
    await flushPageEffects();

    const cleanupButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((element) => element.textContent?.trim() === "整理 memdir");
    expect(cleanupButton).toBeTruthy();

    await act(async () => {
      cleanupButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await flushPageEffects();

    expect(mockCleanupContextMemdir).toHaveBeenCalledWith("/tmp/workspace");
    expect(document.body.textContent ?? "").toContain(
      "已整理 memdir：更新 2 个文件，收口 1 个 topic，清掉 4 处重复或过期内容",
    );
  });

  it("应兼容旧的 durable category 深链，并支持带回创作输入", async () => {
    const onNavigate = vi.fn();
    renderPage({ section: "identity", onNavigate });
    await flushPageEffects();

    expect(document.body.textContent ?? "").toContain("灵感对象分层");
    expect(document.body.textContent ?? "").toContain("灵感条目明细");
    expect(document.body.textContent ?? "").toContain("夏日短视频语气");

    const button = Array.from(document.body.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("带回创作输入"),
    );
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
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
        initialUserPrompt:
          expect.stringContaining("标签：小红书、口播、夏日氛围"),
      }),
    );

    const sceneButton = Array.from(document.body.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("去全部做法"),
    );
    expect(sceneButton).toBeTruthy();

    await act(async () => {
      sceneButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onNavigate).toHaveBeenCalledWith("sceneapps", {
      view: "catalog",
      projectId: "project-42",
      referenceMemoryIds: ["memory-1"],
      search: "夏日短视频语气",
      prefillIntent: expect.stringContaining("围绕这条风格灵感继续创作：夏日短视频语气"),
    });
  });

  it("应支持落到成果分区并对准当前续接的灵感条目", async () => {
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    const scrollIntoViewMock = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoViewMock,
    });
    mockListUnifiedMemories.mockResolvedValue([
      {
        id: "memory-2",
        session_id: "session-1",
        memory_type: "conversation",
        category: "experience",
        title: "短视频编排 · 复核阻塞",
        summary: "当前结果包已完整回流，可继续进入下一轮。",
        content: [
          "场景：短视频编排",
          "结果摘要：这轮内容已经产出一版完整结果包。",
          "当前交付：已交付 3/4 个部件",
          "建议下一步：先完成复核，再决定下一轮放量",
          "当前信号：复核阻塞",
        ].join("\n"),
        updated_at: 1_712_345_779_000,
        created_at: 1_712_345_700_000,
        tags: ["短视频", "复核阻塞"],
        metadata: {
          source: "manual",
        },
      },
    ]);

    renderPage({
      section: "experience",
      focusMemoryTitle: "短视频编排 · 复核阻塞",
      focusMemoryCategory: "experience",
    });
    try {
      await flushPageEffects();

      const focusedEntry = document.body.querySelector(
        '[data-testid="memory-durable-entry-memory-2"]',
      ) as HTMLElement | null;
      expect(focusedEntry).toBeTruthy();
      expect(focusedEntry?.className).toContain("border-emerald-300");
      expect(focusedEntry?.textContent).toContain("当前续接");
      expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    } finally {
      if (originalScrollIntoView) {
        Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
          configurable: true,
          value: originalScrollIntoView,
        });
      } else {
        delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
      }
    }
  });

  it("应支持围绕当前续接成果直接开始下一步，并优先带上这条成果", async () => {
    const onNavigate = vi.fn();
    mockListUnifiedMemories.mockResolvedValue([
      {
        id: "memory-2",
        session_id: "session-1",
        memory_type: "conversation",
        category: "experience",
        title: "短视频编排 · 复核阻塞",
        summary: "当前结果包已完整回流，可继续进入下一轮。",
        content: [
          "场景：短视频编排",
          "结果摘要：这轮内容已经产出一版完整结果包。",
          "当前交付：已交付 3/4 个部件",
          "建议下一步：先完成复核，再决定下一轮放量",
          "当前信号：复核阻塞",
        ].join("\n"),
        updated_at: 1_712_345_779_000,
        created_at: 1_712_345_700_000,
        tags: ["短视频", "复核阻塞"],
        metadata: {
          source: "manual",
        },
      },
    ]);

    renderPage({
      section: "experience",
      focusMemoryTitle: "短视频编排 · 复核阻塞",
      focusMemoryCategory: "experience",
      onNavigate,
    });
    await flushPageEffects();

    const bodyText = document.body.textContent ?? "";
    expect(bodyText).toContain("围绕这条成果继续");
    expect(bodyText).toContain("当前续接成果");
    expect(bodyText).toContain("复盘这个账号/项目");

    const reviewCard = document.body.querySelector(
      '[data-testid="memory-focused-suggestion-panel-task-account-project-review"]',
    ) as HTMLElement | null;
    const trendCard = document.body.querySelector(
      '[data-testid="memory-focused-suggestion-panel-task-daily-trend-briefing"]',
    ) as HTMLElement | null;
    const longformCard = document.body.querySelector(
      '[data-testid="memory-focused-suggestion-panel-task-longform-multiplatform-rewrite"]',
    ) as HTMLElement | null;

    expect(reviewCard?.textContent).toContain("围绕当前成果");
    expect(reviewCard?.textContent).toContain("复盘这个账号/项目");
    expect(trendCard?.textContent).toContain("承接当前结果");
    expect(trendCard?.textContent).toContain("每日趋势摘要");
    expect(longformCard).toBeNull();

    const launchButton = Array.from(
      reviewCard?.querySelectorAll("button") ?? [],
    ).find((element) => element.textContent?.includes("开始这一步"));
    expect(launchButton).toBeTruthy();

    await act(async () => {
      launchButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await flushPageEffects();

    const goalField = document.body.querySelector(
      'input[placeholder="例如 一个季度涨粉 1 万、提升新品转化、连续 30 天稳定输出"]',
    ) as HTMLInputElement | null;
    const resultField = document.body.querySelector(
      'textarea[placeholder="贴关键数据、结果摘要、最近内容表现，或当前遇到的问题"]',
    ) as HTMLTextAreaElement | null;

    expect(goalField?.value).toBe("短视频编排");
    expect(resultField?.value).toContain("当前结果包已完整回流，可继续进入下一轮。");
    expect(resultField?.value).toContain("当前交付：已交付 3/4 个部件");
    expect(resultField?.value).toContain("建议下一步：先完成复核，再决定下一轮放量");

    const confirmButton = document.body.querySelector(
      '[data-testid="curated-task-launcher-confirm"]',
    ) as HTMLButtonElement | null;
    expect(confirmButton).toBeTruthy();

    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onNavigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        initialInputCapability: expect.objectContaining({
          capabilityRoute: expect.objectContaining({
            taskId: "account-project-review",
            referenceMemoryIds: ["memory-2"],
            launchInputValues: {
              project_goal: "短视频编排",
              existing_results: expect.stringContaining(
                "当前结果包已完整回流，可继续进入下一轮。",
              ),
            },
            referenceEntries: expect.arrayContaining([
              expect.objectContaining({
                id: "memory-2",
                title: "短视频编排 · 复核阻塞",
                category: "experience",
              }),
            ]),
          }),
        }),
        initialRequestMetadata: expect.objectContaining({
          harness: expect.objectContaining({
            creation_replay: expect.objectContaining({
              source: expect.objectContaining({
                entry_id: "memory-2",
              }),
            }),
          }),
        }),
      }),
    );
  });

  it("应支持带着当前会话上下文打开运行时记忆命中预演", async () => {
    window.localStorage.setItem(
      "lime:team-memory:/tmp/workspace",
      JSON.stringify({
        repoScope: "/tmp/workspace",
        entries: {
          "team.selection": {
            key: "team.selection",
            content: "研究协作队",
            updatedAt: 1_712_345_678_900,
          },
        },
      }),
    );
    mockPrefetchContextMemoryForTurn.mockResolvedValue({
      session_id: "session-runtime-1",
      rules_source_paths: ["/tmp/workspace/.lime/AGENTS.md"],
      working_memory_excerpt: "【task_plan.md】继续整理证据与风险结论。",
      durable_memories: [
        {
          id: "durable-runtime-1",
          session_id: "session-runtime-1",
          category: "experience",
          title: "研究输出格式偏好",
          summary: "先结论，再列风险与证据",
          updated_at: 1_712_345_678_900,
          tags: ["研究"],
        },
      ],
      team_memory_entries: [
        {
          key: "team.selection",
          content: "研究协作队",
          updated_at: 1_712_345_678_900,
        },
      ],
      latest_compaction: {
        session_id: "session-runtime-1",
        source: "summary_cache",
        summary_preview: "保留结论结构与关键证据链接。",
        turn_count: 5,
        created_at: 1_712_345_678_900,
        trigger: "token_budget",
      },
      prompt: "【运行时记忆召回】研究输出格式偏好",
    });

    renderPage({
      runtimeSessionId: "session-runtime-1",
      runtimeWorkingDir: "/tmp/workspace",
      runtimeUserMessage: "继续整理运行时预演",
    });
    await flushPageEffects();

    const bodyText = document.body.textContent ?? "";
    expect(bodyText).toContain("当前运行时预演");
    expect(bodyText).toContain("最近运行时命中");
    expect(bodyText).toContain("会话：session-runtime-1");
    expect(bodyText).toContain("工作区：/tmp/workspace");
    expect(bodyText).toContain("本回合记忆预取");
    expect(bodyText).toContain("记忆命中预演");
    expect(bodyText).toContain("研究输出格式偏好");
    expect(bodyText).toContain("研究协作队");
    expect(bodyText).toContain("【运行时记忆召回】");
    expect(bodyText).toContain("来自灵感库");
    expect(bodyText).toContain("切换到这次对照");
    expect(mockPrefetchContextMemoryForTurn).toHaveBeenCalledWith({
      session_id: "session-runtime-1",
      working_dir: "/tmp/workspace",
      user_message: "继续整理运行时预演",
      request_metadata: {
        team_memory_shadow: {
          repo_scope: "/tmp/workspace",
          entries: [
            {
              key: "team.selection",
              content: "研究协作队",
              updated_at: 1_712_345_678_900,
            },
          ],
        },
      },
    });
  });

  it("应支持把当前预演和历史基线正面对照，并允许切换基线", async () => {
    recordRuntimeMemoryPrefetchHistory({
      sessionId: "session-runtime-compare-a",
      workingDir: "/tmp/workspace",
      userMessage: "基线第一轮",
      source: "thread_reliability",
      capturedAt: 1_712_345_677_900,
      result: {
        session_id: "session-runtime-compare-a",
        rules_source_paths: ["/tmp/workspace/.lime/AGENTS.md"],
        working_memory_excerpt: null,
        durable_memories: [],
        team_memory_entries: [],
        latest_compaction: null,
        prompt: null,
      },
    });
    recordRuntimeMemoryPrefetchHistory({
      sessionId: "session-runtime-compare-b",
      workingDir: "/tmp/workspace",
      userMessage: "基线第二轮",
      source: "memory_page",
      capturedAt: 1_712_345_678_900,
      result: {
        session_id: "session-runtime-compare-b",
        rules_source_paths: ["/tmp/workspace/.lime/AGENTS.md"],
        working_memory_excerpt: "【task_plan.md】旧版工作摘录。",
        durable_memories: [],
        team_memory_entries: [],
        latest_compaction: null,
        prompt: null,
      },
    });

    mockPrefetchContextMemoryForTurn.mockResolvedValue({
      session_id: "session-runtime-current",
      rules_source_paths: [
        "/tmp/workspace/.lime/AGENTS.md",
        "/tmp/workspace/.memory/rules.md",
      ],
      working_memory_excerpt: "【task_plan.md】新版工作摘录。",
      durable_memories: [
        {
          id: "durable-runtime-compare-1",
          session_id: "session-runtime-current",
          category: "experience",
          title: "当前运行时长期记忆",
          summary: "当前回合新增结构化沉淀。",
          updated_at: 1_712_345_679_900,
          tags: [],
        },
      ],
      team_memory_entries: [],
      latest_compaction: null,
      prompt: null,
    });

    renderPage({
      runtimeSessionId: "session-runtime-current",
      runtimeWorkingDir: "/tmp/workspace",
      runtimeUserMessage: "继续对照当前预演",
    });
    await flushPageEffects();

    let bodyText = document.body.textContent ?? "";
    expect(bodyText).toContain("当前预演 vs 历史基线");
    expect(bodyText).toContain("基线输入：基线第二轮");
    expect(bodyText).toContain("补强");
    expect(bodyText).toContain("补强层：规则层、持久层。 摘要内容也有更新。");
    expect(bodyText).toContain("规则 +1");
    expect(bodyText).toContain("持久 +1");
    expect(bodyText).toContain(
      "工作摘录 【task_plan.md】旧版工作摘录。 -> 【task_plan.md】新版工作摘录。",
    );
    expect(bodyText).toContain("当前基线");
    expect(bodyText).toContain("设为对照基线");

    const switchBaselineButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((element) => element.textContent?.trim() === "设为对照基线");
    expect(switchBaselineButton).toBeTruthy();

    await act(async () => {
      switchBaselineButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    bodyText = document.body.textContent ?? "";
    expect(bodyText).toContain("基线输入：基线第一轮");
  });

  it("切换记忆分区时应保留当前运行时上下文", async () => {
    const onNavigate = vi.fn();
    renderPage({
      onNavigate,
      runtimeSessionId: "session-runtime-2",
      runtimeWorkingDir: "/tmp/workspace",
      runtimeUserMessage: "继续沿当前上下文排查",
    });
    await flushPageEffects();

    const rulesButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find(
      (element) =>
        element.textContent?.includes("记忆来源") &&
        !element.textContent?.includes("看来源链"),
    );
    expect(rulesButton).toBeTruthy();

    await act(async () => {
      rulesButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onNavigate).toHaveBeenCalledWith("memory", {
      section: "rules",
      runtimeSessionId: "session-runtime-2",
      runtimeWorkingDir: "/tmp/workspace",
      runtimeUserMessage: "继续沿当前上下文排查",
    });
  });

  it("在非总览分区也应提示当前仍处于运行时对照模式", async () => {
    renderPage({
      section: "rules",
      runtimeSessionId: "session-runtime-3",
      runtimeWorkingDir: "/tmp/workspace",
      runtimeUserMessage: "继续检查规则命中",
    });
    await flushPageEffects();

    const bodyText = document.body.textContent ?? "";
    expect(bodyText).toContain("当前运行时对照模式");
    expect(bodyText).toContain("返回总览预演");
    expect(bodyText).toContain("会话：session-runtime-3");
    expect(bodyText).toContain("工作区：/tmp/workspace");
    expect(bodyText).toContain("本轮输入：继续检查规则命中");
  });

  it("应展示最近命中相对上一条的差异", async () => {
    recordRuntimeMemoryPrefetchHistory({
      sessionId: "session-history-prev",
      workingDir: "/tmp/workspace",
      userMessage: "继续输出第一版",
      source: "thread_reliability",
      capturedAt: 1_712_345_678_900,
      result: {
        session_id: "session-history-prev",
        rules_source_paths: ["/tmp/workspace/.lime/AGENTS.md"],
        working_memory_excerpt: null,
        durable_memories: [],
        team_memory_entries: [],
        latest_compaction: null,
        prompt: null,
      },
    });

    recordRuntimeMemoryPrefetchHistory({
      sessionId: "session-history-prev",
      workingDir: "/tmp/workspace",
      userMessage: "继续输出第二版",
      source: "memory_page",
      capturedAt: 1_712_345_679_900,
      result: {
        session_id: "session-history-prev",
        rules_source_paths: [
          "/tmp/workspace/.lime/AGENTS.md",
          "/tmp/workspace/.memory/rules.md",
        ],
        working_memory_excerpt: "【task_plan.md】补上证据与风险。",
        durable_memories: [
          {
            id: "durable-history-1",
            session_id: "session-history-prev",
            category: "experience",
            title: "研究输出格式偏好",
            summary: "先结论，再列风险",
            updated_at: 1_712_345_679_900,
            tags: [],
          },
        ],
        team_memory_entries: [
          {
            key: "team.selection",
            content: "研究协作队",
            updated_at: 1_712_345_679_900,
          },
        ],
        latest_compaction: {
          session_id: "session-history-prev",
          source: "summary_cache",
          summary_preview: "保留研究结论与证据结构。",
          created_at: 1_712_345_679_900,
          trigger: "token_budget",
        },
        prompt: null,
      },
    });

    renderPage();
    await flushPageEffects();

    const bodyText = document.body.textContent ?? "";
    expect(bodyText).toContain("较上一条判断");
    expect(bodyText).toContain(
      "补强层：规则层、工作层、持久层、Team 层、压缩层。 摘要内容也有更新。",
    );
    expect(bodyText).toContain("规则 +1");
    expect(bodyText).toContain("工作 新命中");
    expect(bodyText).toContain("持久 +1");
    expect(bodyText).toContain("Team +1");
    expect(bodyText).toContain("压缩 新命中");
    expect(bodyText).toContain("输入 继续输出第一版 -> 继续输出第二版");
  });

  it("应展示当前范围内的层稳定性判断", async () => {
    recordRuntimeMemoryPrefetchHistory({
      sessionId: "session-stability",
      workingDir: "/tmp/workspace",
      userMessage: "继续观察层稳定性第一轮",
      source: "thread_reliability",
      capturedAt: 1_712_345_678_900,
      result: {
        session_id: "session-stability",
        rules_source_paths: ["/tmp/workspace/.lime/AGENTS.md"],
        working_memory_excerpt: null,
        durable_memories: [],
        team_memory_entries: [],
        latest_compaction: null,
        prompt: null,
      },
    });
    recordRuntimeMemoryPrefetchHistory({
      sessionId: "session-stability",
      workingDir: "/tmp/workspace",
      userMessage: "继续观察层稳定性第二轮",
      source: "memory_page",
      capturedAt: 1_712_345_679_900,
      result: {
        session_id: "session-stability",
        rules_source_paths: ["/tmp/workspace/.lime/AGENTS.md"],
        working_memory_excerpt: null,
        durable_memories: [],
        team_memory_entries: [],
        latest_compaction: null,
        prompt: null,
      },
    });

    renderPage();
    await flushPageEffects();

    const bodyText = document.body.textContent ?? "";
    expect(bodyText).toContain("稳定命中");
    expect(bodyText).toContain("最近 2 次都命中规则层，且没有出现层值变化。");
    expect(bodyText).toContain("一直缺失");
    expect(bodyText).toContain("最近 2 次里都没有命中工作层。");
  });

  it("带运行时上下文时应默认聚焦当前工作区，并允许切换查看全部或当前会话", async () => {
    recordRuntimeMemoryPrefetchHistory({
      sessionId: "session-runtime-filter",
      workingDir: "/tmp/workspace",
      userMessage: "当前工作区旧记录",
      source: "thread_reliability",
      capturedAt: 1_712_345_678_900,
      result: {
        session_id: "session-runtime-filter",
        rules_source_paths: ["/tmp/workspace/.lime/AGENTS.md"],
        working_memory_excerpt: null,
        durable_memories: [],
        team_memory_entries: [],
        latest_compaction: null,
        prompt: null,
      },
    });
    recordRuntimeMemoryPrefetchHistory({
      sessionId: "session-other",
      workingDir: "/tmp/other",
      userMessage: "其他工作区记录",
      source: "memory_page",
      capturedAt: 1_712_345_679_900,
      result: {
        session_id: "session-other",
        rules_source_paths: ["/tmp/other/.lime/AGENTS.md"],
        working_memory_excerpt: null,
        durable_memories: [],
        team_memory_entries: [],
        latest_compaction: null,
        prompt: null,
      },
    });

    renderPage({
      runtimeSessionId: "session-runtime-filter",
      runtimeWorkingDir: "/tmp/workspace",
      runtimeUserMessage: "当前对照输入",
    });
    await flushPageEffects();

    expect(document.body.textContent ?? "").not.toContain("其他工作区记录");

    const allButton = Array.from(document.body.querySelectorAll("button")).find(
      (element) => element.textContent?.trim() === "全部",
    );
    expect(allButton).toBeTruthy();

    await act(async () => {
      allButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(document.body.textContent ?? "").toContain("其他工作区记录");

    const sessionButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((element) => element.textContent?.trim() === "当前会话");
    expect(sessionButton).toBeTruthy();

    await act(async () => {
      sessionButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const bodyText = document.body.textContent ?? "";
    expect(bodyText).toContain("当前范围：当前会话");
    expect(bodyText).not.toContain("session-other");
    expect(bodyText).not.toContain("其他工作区记录");
  });

  it("应支持清空最近运行时命中历史", async () => {
    recordRuntimeMemoryPrefetchHistory({
      sessionId: "session-clear-history",
      workingDir: "/tmp/workspace",
      userMessage: "待清空记录",
      source: "thread_reliability",
      capturedAt: 1_712_345_678_900,
      result: {
        session_id: "session-clear-history",
        rules_source_paths: [],
        working_memory_excerpt: null,
        durable_memories: [],
        team_memory_entries: [],
        latest_compaction: null,
        prompt: null,
      },
    });

    renderPage();
    await flushPageEffects();

    expect(document.body.textContent ?? "").toContain("待清空记录");

    const clearButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((element) => element.textContent?.includes("清空历史"));
    expect(clearButton).toBeTruthy();

    await act(async () => {
      clearButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(document.body.textContent ?? "").toContain(
      "当前还没有运行时命中历史。先在对话工作台触发几轮记忆预演，这里会自动沉淀最近记录。",
    );
  });
});
