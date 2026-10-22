import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFilePreview } from "@/lib/api/fileBrowser";
import { readAgentThreadItemFromPayload } from "@/lib/api/agentRuntime/appServerEventTimelineReaders";
import type { AgentThreadItem } from "../types";
import { resolveTimelineArtifactNavigation } from "../utils/artifactTimelineNavigation";
import {
  useWorkspaceArtifactOpenRuntime,
  type UseWorkspaceArtifactOpenRuntimeParams,
} from "./useWorkspaceArtifactOpenRuntime";

vi.mock("@/lib/api/fileBrowser", () => ({ readFilePreview: vi.fn() }));
vi.mock("../hooks/useArtifactAutoPreviewSync", () => ({
  useArtifactAutoPreviewSync: vi.fn(),
}));
vi.mock("./useWorkspaceArtifactDocumentSaveRuntime", () => ({
  useWorkspaceArtifactDocumentSaveRuntime: () => vi.fn(),
}));
vi.mock("./useWorkspaceArtifactWorkbenchActions", () => ({
  useWorkspaceArtifactWorkbenchActions: () => ({
    renderToolbarActions: vi.fn(),
  }),
}));

let root: Root;
let container: HTMLDivElement;
let runtime: ReturnType<typeof useWorkspaceArtifactOpenRuntime>;

function mount(overrides: Partial<UseWorkspaceArtifactOpenRuntimeParams> = {}) {
  const params: UseWorkspaceArtifactOpenRuntimeParams = {
    activeTheme: "general",
    artifacts: [],
    currentCanvasArtifact: null,
    effectiveThreadItems: [],
    generalCanvasState: { isOpen: false, contentType: "empty", content: "" },
    handleWriteFile: vi.fn(),
    isInitialContentLoading: false,
    layoutMode: "chat",
    messages: [],
    openArticleWorkspaceRightSurface: vi.fn(),
    openWorkspaceFile: vi.fn(),
    projectRootPath: "/workspace",
    readSessionFile: vi.fn(async () => null),
    sessionFiles: [],
    setArtifactViewMode: vi.fn(),
    setCanvasState: vi.fn(),
    setCanvasWorkbenchLayoutMode: vi.fn(),
    setExpertInfoPanelCollapsed: vi.fn(),
    setGeneralCanvasState: vi.fn(),
    setHarnessPanelVisible: vi.fn(),
    setLayoutMode: vi.fn(),
    setSelectedArtifactId: vi.fn(),
    syncGeneralArtifactToResource: vi.fn(),
    taskFiles: [],
    updateCurrentImageWorkbenchState: vi.fn(),
    upsertGeneralArtifact: vi.fn(),
    workbenchRequests: {
      clearFocusedArtifactBlock: vi.fn(),
      focusArtifactBlock: vi.fn(),
      requestCanvasWorkbenchPreviewOpen: vi.fn(),
    } as unknown as UseWorkspaceArtifactOpenRuntimeParams["workbenchRequests"],
    ...overrides,
  };
  function Probe() {
    runtime = useWorkspaceArtifactOpenRuntime(params);
    return null;
  }
  act(() => root.render(<Probe />));
  return params;
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(readFilePreview).mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Workspace 文件重新打开", () => {
  it("已保存站点的项目文件直接进入当前 Files", async () => {
    const params = mount({ projectId: "project-1", onNavigate: vi.fn() });
    await act(async () => {
      await runtime.handleOpenSavedSiteContent({
        projectId: "project-1",
        contentId: "site-1",
        preferredTarget: "project_file",
        projectFile: { relativePath: "site/index.html" },
      });
    });
    expect(params.openWorkspaceFile).toHaveBeenCalledExactlyOnceWith(
      "/workspace/site/index.html",
    );
    expect(params.onNavigate).not.toHaveBeenCalled();
    expect(readFilePreview).not.toHaveBeenCalled();
    expect(params.upsertGeneralArtifact).not.toHaveBeenCalled();
  });

  it("其他项目的站点文件保留真实路由与初始文件目标", async () => {
    const params = mount({ projectId: "project-1", onNavigate: vi.fn() });
    await act(async () => {
      await runtime.handleOpenSavedSiteContent({
        projectId: "project-2",
        contentId: "site-2",
        preferredTarget: "project_file",
        projectFile: { relativePath: "site/index.html" },
      });
    });
    expect(params.openWorkspaceFile).not.toHaveBeenCalled();
    expect(params.onNavigate).toHaveBeenCalledExactlyOnceWith(
      "agent",
      expect.objectContaining({
        projectId: "project-2",
        contentId: "site-2",
        initialProjectFileOpenTarget: {
          relativePath: "site/index.html",
          requestKey: expect.any(Number),
        },
      }),
    );
  });

  it("初始项目文件目标直接激活 Files，不先读取或生成 Artifact", () => {
    const params = mount({
      initialProjectFileOpenTarget: {
        relativePath: "reports/report.pdf",
        requestKey: 7,
      },
    });
    expect(params.openWorkspaceFile).toHaveBeenCalledExactlyOnceWith(
      "/workspace/reports/report.pdf",
    );
    expect(readFilePreview).not.toHaveBeenCalled();
    expect(params.upsertGeneralArtifact).not.toHaveBeenCalled();
  });

  it("初始内容尚未恢复时不提前打开文件", () => {
    const params = mount({
      contentId: "content-1",
      isInitialContentLoading: true,
      initialProjectFileOpenTarget: {
        relativePath: "reports/report.pdf",
        requestKey: 7,
      },
    });
    expect(params.openWorkspaceFile).not.toHaveBeenCalled();
    expect(readFilePreview).not.toHaveBeenCalled();
  });

  it("服务结果文件进入同一个 Files owner", async () => {
    const params = mount();
    await act(async () => {
      await runtime.handleOpenServiceSkillResultFile("reports/report.xlsx");
    });
    expect(params.openWorkspaceFile).toHaveBeenCalledExactlyOnceWith(
      "/workspace/reports/report.xlsx",
    );
    expect(readFilePreview).not.toHaveBeenCalled();
    expect(params.upsertGeneralArtifact).not.toHaveBeenCalled();
  });

  it("正文资源引用直接激活文件 owner，不进入产物预览或读取副本", () => {
    const params = mount();
    act(() =>
      runtime.handleOpenArtifactFromTimeline({
        timelineItemId: "user-item-1",
        filePath: "/skills/Review work/SKILL.md",
        content: "",
        openMode: "file_preview",
      }),
    );
    expect(params.openWorkspaceFile).toHaveBeenCalledExactlyOnceWith(
      "/skills/Review work/SKILL.md",
    );
    expect(params.setHarnessPanelVisible).toHaveBeenCalledWith(false);
    expect(params.setExpertInfoPanelCollapsed).toHaveBeenCalledWith(true);
    expect(readFilePreview).not.toHaveBeenCalled();
    expect(params.upsertGeneralArtifact).not.toHaveBeenCalled();
    expect(
      params.workbenchRequests.requestCanvasWorkbenchPreviewOpen,
    ).not.toHaveBeenCalled();
  });

  it.each([
    "pdf",
    "docx",
    "xlsx",
    "csv",
    "tsv",
    "pptx",
    "png",
    "jpg",
    "svg",
    "wav",
    "mp3",
    "mp4",
    "webm",
    "html",
    "bin",
  ])(
    "canonical file-read 历史 %s 经时间线打开时保留原文件路径",
    async (extension) => {
      const fileName = `report.${extension}`;
      const path = `/documents/reports/${fileName}`;
      vi.mocked(readFilePreview).mockResolvedValue({
        path,
        content: null,
        isBinary: true,
        size: 2048,
        error: null,
      });
      const params = mount({
        projectRootPath: null,
        taskFiles: [
          {
            id: "same-name-task-file",
            name: fileName,
            type: "document",
            content: "旧抽取文本",
            version: 1,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        sessionFiles: [
          {
            name: fileName,
            fileType: extension,
            size: 100,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      });
      const projected = readAgentThreadItemFromPayload(
        {
          id: "canonical-file-read-item",
          type: "file_artifact",
          status: "completed",
          path,
          source: "file_read",
          content: "历史中的抽取文本",
        },
        {
          eventId: "canonical-file-read",
          sequence: 7,
          sessionId: "session-1",
          threadId: "thread-1",
          turnId: "turn-1",
          type: "item.completed",
          timestamp: "2026-10-17T00:00:00Z",
          payload: {},
        },
        "completed",
      );
      const navigation = resolveTimelineArtifactNavigation(
        projected as unknown as AgentThreadItem,
      );
      expect(navigation).not.toBeNull();
      await act(async () => {
        runtime.handleOpenArtifactFromTimeline(navigation!.rootTarget);
        await Promise.resolve();
      });
      expect(params.openWorkspaceFile).toHaveBeenCalledExactlyOnceWith(path);
      expect(readFilePreview).not.toHaveBeenCalled();
      expect(params.readSessionFile).not.toHaveBeenCalled();
      expect(params.upsertGeneralArtifact).not.toHaveBeenCalled();
      expect(
        params.workbenchRequests.requestCanvasWorkbenchPreviewOpen,
      ).not.toHaveBeenCalled();
    },
  );

  it.each(
    ["pdf", "docx", "xlsx", "csv", "tsv", "pptx"].flatMap((extension) =>
      ([undefined, "artifact_review"] as const).map((openMode) => ({
        extension,
        openMode,
      })),
    ),
  )(
    "时间线 $extension ($openMode) 直接打开 Files，不创建 Canvas 投影或读取副本",
    async ({ extension, openMode }) => {
      const path = `/workspace/report.${extension}`;
      vi.mocked(readFilePreview).mockResolvedValue({
        path,
        content: null,
        isBinary: true,
        size: 2048,
        error: null,
      });
      const params = mount();
      await act(async () => {
        runtime.handleOpenArtifactFromTimeline({
          timelineItemId: "canonical-item-1",
          filePath: `report.${extension}`,
          content: "# Extracted text",
          openMode,
        });
        await Promise.resolve();
      });
      expect(params.openWorkspaceFile).toHaveBeenCalledExactlyOnceWith(path);
      expect(params.setHarnessPanelVisible).toHaveBeenCalledWith(false);
      expect(params.setExpertInfoPanelCollapsed).toHaveBeenCalledWith(true);
      expect(readFilePreview).not.toHaveBeenCalled();
      expect(params.readSessionFile).not.toHaveBeenCalled();
      expect(params.upsertGeneralArtifact).not.toHaveBeenCalled();
      expect(params.setGeneralCanvasState).not.toHaveBeenCalled();
      expect(params.setCanvasState).not.toHaveBeenCalled();
      expect(
        params.workbenchRequests.requestCanvasWorkbenchPreviewOpen,
      ).not.toHaveBeenCalled();
      expect(
        params.workbenchRequests.focusArtifactBlock,
      ).not.toHaveBeenCalled();
    },
  );
  it.each(["", "stale cached text"])(
    "文件入口直接打开原件，缓存正文为 %j",
    async (content) => {
      const params = mount();
      await act(async () => {
        runtime.handleWorkspaceFileClick("reports/report.docx", content);
      });
      expect(params.openWorkspaceFile).toHaveBeenCalledExactlyOnceWith(
        "/workspace/reports/report.docx",
      );
      expect(
        params.workbenchRequests.clearFocusedArtifactBlock,
      ).toHaveBeenCalledOnce();
      expect(params.setHarnessPanelVisible).toHaveBeenCalledWith(false);
      expect(params.setExpertInfoPanelCollapsed).toHaveBeenCalledWith(true);
      expect(params.upsertGeneralArtifact).not.toHaveBeenCalled();
      expect(params.setCanvasState).not.toHaveBeenCalled();
      expect(
        params.workbenchRequests.requestCanvasWorkbenchPreviewOpen,
      ).not.toHaveBeenCalled();
      expect(readFilePreview).not.toHaveBeenCalled();
    },
  );
});
