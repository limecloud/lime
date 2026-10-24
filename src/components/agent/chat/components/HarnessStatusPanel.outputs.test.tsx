import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  createHarnessState,
  getHarnessPanelTestMocks,
  renderPanel,
} from "./HarnessStatusPanel.testFixtures";

describe("HarnessStatusPanel outputs", () => {
  it("应渲染最近文件活动区块", () => {
    renderPanel({
      layout: "dialog",
      harnessState: createHarnessState({
        recentFileEvents: [
          {
            id: "event-1",
            toolCallId: "tool-1",
            path: "/tmp/workspace/draft.md",
            displayName: "draft.md",
            kind: "document",
            action: "write",
            sourceToolName: "Write",
            timestamp: new Date("2026-03-11T12:00:00.000Z"),
            preview: "# 草稿\n这是预览",
            clickable: true,
          },
        ],
      }),
    });

    expect(document.body.textContent).toContain("最近文件活动");
    expect(document.body.textContent).toContain("draft.md");
    expect(document.body.textContent).toContain("写入");
    expect(document.body.textContent).toContain("这是预览");
  });

  it("点击文件活动后应加载并展示预览内容", async () => {
    const onLoadFilePreview = vi.fn().mockResolvedValue({
      path: "/tmp/workspace/draft.md",
      content: "# 标题\n正文内容",
      isBinary: false,
      size: 18,
      error: null,
    });
    const onOpenFile = vi.fn();

    renderPanel({
      layout: "dialog",
      harnessState: createHarnessState({
        recentFileEvents: [
          {
            id: "event-2",
            toolCallId: "tool-2",
            path: "/tmp/workspace/draft.md",
            displayName: "draft.md",
            kind: "document",
            action: "read",
            sourceToolName: "Read",
            timestamp: new Date("2026-03-11T12:01:00.000Z"),
            preview: "摘要预览",
            clickable: true,
          },
        ],
      }),
      onLoadFilePreview,
      onOpenFile,
    });

    const trigger = document.body.querySelector(
      'button[aria-label="查看文件活动：draft.md"]',
    ) as HTMLButtonElement | null;

    await act(async () => {
      trigger?.click();
      await Promise.resolve();
    });

    expect(onLoadFilePreview).toHaveBeenCalledWith("/tmp/workspace/draft.md");
    expect(document.body.textContent).toContain("# 标题");
    expect(document.body.textContent).toContain("正文内容");

    const openInChatButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("在会话中打开"));

    act(() => {
      openInChatButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(onOpenFile).toHaveBeenCalledWith(
      "/tmp/workspace/draft.md",
      "# 标题\n正文内容",
    );
  });

  it("应支持按类型筛选最近文件活动", () => {
    renderPanel({
      layout: "dialog",
      harnessState: createHarnessState({
        recentFileEvents: [
          {
            id: "event-filter-doc",
            toolCallId: "tool-filter-doc",
            path: "/tmp/workspace/spec.md",
            displayName: "spec.md",
            kind: "document",
            action: "write",
            sourceToolName: "Write",
            timestamp: new Date("2026-03-11T12:10:00.000Z"),
            preview: "需求说明",
            clickable: true,
          },
          {
            id: "event-filter-code",
            toolCallId: "tool-filter-code",
            path: "/tmp/workspace/app.ts",
            displayName: "app.ts",
            kind: "code",
            action: "edit",
            sourceToolName: "Edit",
            timestamp: new Date("2026-03-11T12:11:00.000Z"),
            preview: "const app = true;",
            clickable: true,
          },
          {
            id: "event-filter-log",
            toolCallId: "tool-filter-log",
            path: "/tmp/workspace/run.log",
            displayName: "run.log",
            kind: "log",
            action: "persist",
            sourceToolName: "Execute",
            timestamp: new Date("2026-03-11T12:12:00.000Z"),
            preview: "执行完成",
            clickable: true,
          },
        ],
      }),
    });

    const codeFilterButton = document.body.querySelector(
      'button[aria-label="文件活动筛选：代码"]',
    ) as HTMLButtonElement | null;

    act(() => {
      codeFilterButton?.click();
    });

    const fileSection = document.body.querySelector(
      '[data-harness-section="files"]',
    ) as HTMLElement | null;

    expect(fileSection?.textContent).toContain("app.ts");
    expect(fileSection?.textContent).not.toContain("spec.md");
    expect(fileSection?.textContent).not.toContain("run.log");
    expect(fileSection?.textContent).toContain("1 / 3 条");
  });

  it("应支持按文件聚合最近文件活动", () => {
    renderPanel({
      layout: "dialog",
      harnessState: createHarnessState({
        recentFileEvents: [
          {
            id: "event-group-1",
            toolCallId: "tool-group-1",
            path: "/tmp/workspace/draft.md",
            displayName: "draft.md",
            kind: "document",
            action: "write",
            sourceToolName: "Write",
            timestamp: new Date("2026-03-11T12:20:00.000Z"),
            preview: "第一版",
            clickable: true,
          },
          {
            id: "event-group-2",
            toolCallId: "tool-group-2",
            path: "/tmp/workspace/draft.md",
            displayName: "draft.md",
            kind: "document",
            action: "edit",
            sourceToolName: "Edit",
            timestamp: new Date("2026-03-11T12:21:00.000Z"),
            preview: "第二版",
            clickable: true,
          },
          {
            id: "event-group-3",
            toolCallId: "tool-group-3",
            path: "/tmp/workspace/notes.md",
            displayName: "notes.md",
            kind: "document",
            action: "read",
            sourceToolName: "Read",
            timestamp: new Date("2026-03-11T12:22:00.000Z"),
            preview: "笔记",
            clickable: true,
          },
        ],
      }),
    });

    const groupedViewButton = document.body.querySelector(
      'button[aria-label="文件视图：按文件"]',
    ) as HTMLButtonElement | null;

    act(() => {
      groupedViewButton?.click();
    });

    const fileSection = document.body.querySelector(
      '[data-harness-section="files"]',
    ) as HTMLElement | null;
    const groupedCards = document.body.querySelectorAll(
      'button[aria-label^="查看聚合文件活动："]',
    );

    expect(groupedCards).toHaveLength(2);
    expect(fileSection?.textContent).toContain("2 个文件 / 3 条");
    expect(fileSection?.textContent).toContain("draft.md");
    expect(fileSection?.textContent).toContain("2 次活动");
    expect(fileSection?.textContent).toContain("写入 1");
    expect(fileSection?.textContent).toContain("编辑 1");
  });

  it("应支持按类型筛选工具输出", () => {
    renderPanel({
      layout: "dialog",
      harnessState: createHarnessState({
        outputSignals: [
          {
            id: "signal-path",
            toolCallId: "tool-path",
            toolName: "read_file",
            title: "读取结果",
            summary: "返回了输出文件",
            outputFile: "/tmp/workspace/output.txt",
          },
          {
            id: "signal-offload",
            toolCallId: "tool-offload",
            toolName: "write_file",
            title: "大结果转存",
            summary: "内容已转存",
            offloadFile: "/tmp/workspace/offload/result.md",
            offloaded: true,
          },
          {
            id: "signal-summary",
            toolCallId: "tool-summary",
            toolName: "execute",
            title: "执行摘要",
            summary: "仅保留摘要",
            preview: "最后 10 行输出",
          },
          {
            id: "signal-truncated",
            toolCallId: "tool-truncated",
            toolName: "execute",
            title: "截断输出",
            summary: "输出过长已截断",
            truncated: true,
          },
        ],
      }),
    });

    const summaryFilterButton = document.body.querySelector(
      'button[aria-label="工具输出筛选：仅摘要"]',
    ) as HTMLButtonElement | null;

    act(() => {
      summaryFilterButton?.click();
    });

    const outputSection = document.body.querySelector(
      '[data-harness-section="outputs"]',
    ) as HTMLElement | null;

    expect(outputSection?.textContent).toContain("执行摘要");
    expect(outputSection?.textContent).not.toContain("读取结果");
    expect(outputSection?.textContent).not.toContain("大结果转存");
    expect(outputSection?.textContent).not.toContain("截断输出");
    expect(outputSection?.textContent).toContain("1 / 4 条");
  });

  it("工具输出应展示执行状态、截断转存和文件位置", () => {
    renderPanel({
      layout: "dialog",
      harnessState: createHarnessState({
        outputSignals: [
          {
            id: "signal-command-output",
            toolCallId: "tool-command-output",
            toolName: "bash",
            title: "测试命令输出",
            summary: "npm exec vitest run HarnessStatusPanel.test.tsx",
            preview: "PASS HarnessStatusPanel.test.tsx",
            outputFile: "/tmp/workspace/.lime/runtime/test-output.txt",
            offloadFile: "/tmp/workspace/.lime/runtime/full-output.txt",
            exitCode: 1,
            stdoutLength: 2048,
            stderrLength: 128,
            sandboxed: true,
            truncated: true,
            offloaded: true,
            offloadOriginalChars: 9000,
            offloadOriginalTokens: 1800,
          },
        ],
      }),
    });

    const outputSection = document.body.querySelector(
      '[data-harness-section="outputs"]',
    ) as HTMLElement | null;

    expect(outputSection?.textContent).toContain("测试命令输出");
    expect(outputSection?.textContent).toContain("退出码 1");
    expect(outputSection?.textContent).toContain("输出已截断");
    expect(outputSection?.textContent).toContain("完整输出已转存");
    expect(outputSection?.textContent).toContain("隔离执行");
    expect(outputSection?.textContent).toContain("stdout 2048");
    expect(outputSection?.textContent).toContain("stderr 128");
    expect(outputSection?.textContent).toContain("原始 9000 字符");
    expect(outputSection?.textContent).toContain("约 1800 tokens");
    expect(outputSection?.textContent).toContain("输出位置");
    expect(outputSection?.textContent).toContain("输出文件");
    expect(outputSection?.textContent).toContain("转存文件");
    expect(outputSection?.textContent).toContain(
      "/tmp/workspace/.lime/runtime/test-output.txt",
    );
    expect(outputSection?.textContent).toContain(
      "/tmp/workspace/.lime/runtime/full-output.txt",
    );
  });

  it("内部错误型工具输出应展示短摘要并收起原始排障文本", () => {
    renderPanel({
      layout: "dialog",
      harnessState: createHarnessState({
        outputSignals: [
          {
            id: "signal-runtime-internal-error",
            toolCallId: "tool-runtime-internal-error",
            toolName: "ToolSearch",
            title: "工具调用失败",
            summary: "-32603: -32002: runtime request failed",
            preview:
              "Troubleshooting: inspect provider logs and raw JSON-RPC response",
            exitCode: 1,
          },
        ],
      }),
    });

    const outputSection = document.body.querySelector(
      '[data-harness-section="outputs"]',
    ) as HTMLElement | null;
    const collapsedCard = document.body.querySelector(
      '[data-output-raw-details-collapsed="true"]',
    );

    expect(collapsedCard).not.toBeNull();
    expect(outputSection?.textContent).toContain(
      "运行时返回内部错误，已保留详情用于排查。",
    );
    expect(outputSection?.textContent).toContain(
      "原始排障内容已收起，点击卡片可查看完整输出。",
    );
    expect(outputSection?.textContent).not.toContain("-32603");
    expect(outputSection?.textContent).not.toContain("Troubleshooting");
  });

  it("搜索输出应展示结果列表并支持悬浮预览", async () => {
    renderPanel({
      layout: "dialog",
      harnessState: createHarnessState({
        outputSignals: [
          {
            id: "signal-search",
            toolCallId: "tool-search",
            toolName: "WebSearch",
            title: "联网检索摘要",
            summary: "3月13日国际新闻",
            content: [
              "Xinhua world news summary at 0030 GMT, March 13",
              "https://example.com/xinhua",
              "全球要闻摘要，覆盖国际局势与市场动态。",
              "",
              "Friday morning news: March 13, 2026 | WORLD - wng.org",
              "https://example.com/wng",
              "补充国际动态与区域冲突更新。",
            ].join("\n"),
          },
        ],
      }),
    });

    expect(document.body.textContent).toContain("3月13日国际新闻");
    expect(document.body.textContent).toContain(
      "Xinhua world news summary at 0030 GMT, March 13",
    );
    expect(document.body.textContent).toContain(
      "Friday morning news: March 13, 2026 | WORLD - wng.org",
    );

    const collapseButton = document.body.querySelector(
      'button[aria-label="收起搜索结果：3月13日国际新闻"]',
    ) as HTMLButtonElement | null;

    act(() => {
      collapseButton?.click();
    });

    expect(document.body.textContent).not.toContain(
      "Xinhua world news summary at 0030 GMT, March 13",
    );

    const expandButton = document.body.querySelector(
      'button[aria-label="展开搜索结果：3月13日国际新闻"]',
    ) as HTMLButtonElement | null;

    act(() => {
      expandButton?.click();
    });

    expect(document.body.textContent).toContain(
      "Xinhua world news summary at 0030 GMT, March 13",
    );

    const firstSearchResult = document.body.querySelector(
      '[aria-label="打开搜索结果：Xinhua world news summary at 0030 GMT, March 13"]',
    ) as HTMLButtonElement | null;

    await act(async () => {
      firstSearchResult?.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain(
      "全球要闻摘要，覆盖国际局势与市场动态。",
    );
    expect(document.body.textContent).toContain("https://example.com/xinhua");
    expect(document.body.querySelector('[data-side="left"]')).not.toBeNull();

    await act(async () => {
      firstSearchResult?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    const { mockOpenExternalUrlWithSystemBrowser } = getHarnessPanelTestMocks();
    expect(mockOpenExternalUrlWithSystemBrowser).toHaveBeenCalledWith(
      "https://example.com/xinhua",
    );
  });

  it("连续多条搜索输出应在 harness 中按搜索批次分组展示", () => {
    renderPanel({
      layout: "dialog",
      harnessState: createHarnessState({
        outputSignals: [
          {
            id: "signal-search-1",
            toolCallId: "tool-search-1",
            toolName: "WebSearch",
            title: "联网检索摘要",
            summary: "3月13日国际新闻",
            content: "https://example.com/1",
          },
          {
            id: "signal-search-2",
            toolCallId: "tool-search-2",
            toolName: "WebSearch",
            title: "联网检索摘要",
            summary: "March 13 2026 world headlines",
            content: "https://example.com/2",
          },
        ],
      }),
    });

    expect(document.body.textContent).toContain("已搜索 2 组查询");
    expect(document.body.textContent).toContain("3月13日国际新闻");
    expect(document.body.textContent).toContain(
      "March 13 2026 world headlines",
    );
    expect(document.body.textContent).toContain("中文日期检索");
    expect(document.body.textContent).toContain("头条检索");
  });

  it("预览弹窗应支持复制路径和系统文件操作", async () => {
    const onLoadFilePreview = vi.fn().mockResolvedValue({
      path: "/tmp/workspace/draft.md",
      content: "# 标题\n正文内容",
      isBinary: false,
      size: 18,
      error: null,
    });
    const onRevealPath = vi.fn().mockResolvedValue(undefined);
    const onOpenPath = vi.fn().mockResolvedValue(undefined);

    renderPanel({
      layout: "dialog",
      harnessState: createHarnessState({
        recentFileEvents: [
          {
            id: "event-3",
            toolCallId: "tool-3",
            path: "/tmp/workspace/draft.md",
            displayName: "draft.md",
            kind: "document",
            action: "read",
            sourceToolName: "Read",
            timestamp: new Date("2026-03-11T12:02:00.000Z"),
            preview: "摘要预览",
            clickable: true,
          },
        ],
      }),
      onLoadFilePreview,
      onRevealPath,
      onOpenPath,
    });

    const trigger = document.body.querySelector(
      'button[aria-label="查看文件活动：draft.md"]',
    ) as HTMLButtonElement | null;

    await act(async () => {
      trigger?.click();
      await Promise.resolve();
    });

    const copyPathButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("复制路径"));
    const revealButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("定位文件"));
    const openPathButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("系统打开"));

    await act(async () => {
      copyPathButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      revealButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      openPathButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "/tmp/workspace/draft.md",
    );
    expect(onRevealPath).toHaveBeenCalledWith("/tmp/workspace/draft.md");
    expect(onOpenPath).toHaveBeenCalledWith("/tmp/workspace/draft.md");
  });

  it("应支持直接点击文件路径并系统打开", async () => {
    const onOpenPath = vi.fn().mockResolvedValue(undefined);

    renderPanel({
      layout: "dialog",
      harnessState: createHarnessState({
        recentFileEvents: [
          {
            id: "event-open-path",
            toolCallId: "tool-open-path",
            path: "/tmp/workspace/direct-open.md",
            displayName: "direct-open.md",
            kind: "document",
            action: "write",
            sourceToolName: "Write",
            timestamp: new Date("2026-03-13T12:20:00.000Z"),
            preview: "直接打开路径",
            clickable: true,
          },
        ],
      }),
      onOpenPath,
    });

    const pathLink = document.body.querySelector(
      '[aria-label="系统打开路径：/tmp/workspace/direct-open.md"]',
    ) as HTMLElement | null;

    await act(async () => {
      pathLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onOpenPath).toHaveBeenCalledWith("/tmp/workspace/direct-open.md");
  });

  it("应支持直接点击工作台中的 URL 链接", async () => {
    renderPanel({
      layout: "dialog",
      harnessState: createHarnessState({
        latestContextTrace: [
          {
            stage: "联网检索",
            detail:
              "已获取资料：https://example.com/report ，可继续打开查看完整来源。",
          },
        ],
      }),
    });

    const urlLink = document.body.querySelector(
      '[aria-label="打开链接：https://example.com/report"]',
    ) as HTMLElement | null;

    await act(async () => {
      urlLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const { mockOpenExternalUrlWithSystemBrowser } = getHarnessPanelTestMocks();
    expect(mockOpenExternalUrlWithSystemBrowser).toHaveBeenCalledWith(
      "https://example.com/report",
    );
  });
});
