import { describe, expect, it } from "vitest";
import type { Artifact } from "@/lib/artifact/types";
import {
  buildEntries,
  isHtmlPreviewContext,
  resolveCodingPreviewTabLabel,
  resolveSelectionContext,
  resolveWorkspaceRelativeDisplayPath,
  type CanvasWorkbenchTaskFile,
  type CanvasWorkbenchCopy,
} from "./CanvasWorkbenchLayoutViewModel";
import { normalizeWorkspacePath } from "../workspace/workspacePath";
import {
  resolvePreviewContent,
  resolvePreviewPath,
} from "../workspace/filePreviewTarget";

function createArtifact(
  id: string,
  filePath: string,
  content: string,
  updatedAt: number,
): Artifact {
  return {
    id,
    type: artifactDocType,
    title: filePath.split("/").pop() || filePath,
    content,
    status: "complete",
    meta: {
      filePath,
      filename: filePath.split("/").pop() || filePath,
      previewText: content,
    },
    position: { start: 0, end: content.length },
    createdAt: updatedAt - 100,
    updatedAt,
  };
}

function createTaskFile(
  id: string,
  name: string,
  content: string,
  updatedAt: number,
): CanvasWorkbenchTaskFile {
  return {
    id,
    name,
    type: taskDocType,
    content,
    version: 1,
    createdAt: updatedAt - 100,
    updatedAt,
  };
}

const copy: CanvasWorkbenchCopy = {
  kind: {
    artifact: "产物",
    currentDraft: "当前文稿",
    currentVersion: "当前",
    defaultDraft: "主稿",
    taskDocument: "文档",
    taskFile: "任务文件",
    version: "版本",
    versionTitle: (count) => `文稿版本 ${count}`,
  },
};

const artifactDocType = ["doc", "ument"].join("") as Artifact["type"];
const taskDocType = ["doc", "ument"].join(
  "",
) as CanvasWorkbenchTaskFile["type"];

describe("CanvasWorkbenchLayoutViewModel", () => {
  it("应归一化 macOS 与 Windows 路径分隔符", () => {
    expect(normalizeWorkspacePath("/workspace/src/index.md")).toBe(
      "/workspace/src/index.md",
    );
    expect(normalizeWorkspacePath("C:\\workspace\\src\\index.md")).toBe(
      "C:/workspace/src/index.md",
    );
  });

  it("应把 workspace 内路径转成展示用相对路径", () => {
    expect(
      resolveWorkspaceRelativeDisplayPath(
        "/workspace",
        "/workspace/src/index.md",
      ),
    ).toBe("src/index.md");
    expect(
      resolveWorkspaceRelativeDisplayPath("/workspace", "/workspace"),
    ).toBe("workspace");
    expect(resolveWorkspaceRelativeDisplayPath(null, "src\\index.md")).toBe(
      "src/index.md",
    );
  });

  it("应从 preview target 解析内容和可操作路径", () => {
    expect(
      resolvePreviewContent({
        kind: "text",
        title: "index.md",
        content: "# 正文",
        filePath: "index.md",
      }),
    ).toBe("# 正文");
    expect(
      resolvePreviewContent({
        kind: "synthetic-artifact",
        title: "draft.md",
        artifact: createArtifact("version-1", "draft.md", "# 版本正文", 10),
        filePath: "draft.md",
      }),
    ).toBe("# 版本正文");
    expect(
      resolvePreviewContent({
        kind: "loading",
        title: "draft.md",
        filePath: "draft.md",
      }),
    ).toBe("");
    expect(
      resolvePreviewPath({
        kind: "text",
        title: "draft.md",
        content: "",
        filePath: "draft.md",
        absolutePath: "/workspace/draft.md",
      }),
    ).toBe("/workspace/draft.md");
  });

  it("应识别 HTML 预览上下文并生成 coding 预览标签", () => {
    expect(
      isHtmlPreviewContext({
        title: "index.html",
        target: { kind: "empty", title: "empty" },
      }),
    ).toBe(true);
    expect(
      isHtmlPreviewContext({
        title: "index.md",
        selectionPath: "dist/app.htm",
        target: { kind: "empty", title: "empty" },
      }),
    ).toBe(true);
    expect(
      isHtmlPreviewContext({
        title: "index.md",
        target: { kind: "empty", title: "empty" },
      }),
    ).toBe(false);
    expect(
      resolveCodingPreviewTabLabel(
        {
          title: "index.html",
          tabLabel: "主页",
          target: { kind: "empty", title: "empty" },
        },
        "预览",
      ),
    ).toBe("预览 · 主页");
    expect(resolveCodingPreviewTabLabel(null, "预览")).toBe("预览");
  });

  it("应构造去重后的产物、任务文件 entry 列表", () => {
    const entries = buildEntries(
      [
        createArtifact("artifact-old", "draft.md", "上一版", 10),
        createArtifact("artifact-dup", "current.md", "应被任务文件覆盖", 20),
        createArtifact("artifact-new", "outline.md", "产物内容", 30),
      ],
      null,
      [
        createTaskFile("task-current", "current.md", "当前主稿", 40),
        createTaskFile("task-latest", "latest.md", "最新任务文件", 50),
      ],
      copy,
      "/workspace",
    );

    expect(entries.map((item) => item.key)).toEqual([
      "artifact:artifact-new",
      "artifact:artifact-old",
      "task:task-latest",
      "task:task-current",
    ]);
    expect(
      entries.find((item) => item.key === "task:task-current"),
    ).toMatchObject({
      title: "current.md",
      absolutePath: "/workspace/current.md",
      badgeLabel: "文档",
      kindLabel: "任务文件",
    });
  });

  it("应解析 default preview、workspace file 和 entry selection", () => {
    const artifact = createArtifact(
      "artifact-current",
      "draft.md",
      "当前产物",
      20,
    );
    const previousArtifact = createArtifact(
      "artifact-previous",
      "draft.md",
      "上一版产物",
      10,
    );
    const entries = buildEntries([previousArtifact, artifact], null, [], copy);
    const entryMap = new Map(entries.map((item) => [item.key, item]));

    expect(
      resolveSelectionContext({
        selectionKey: null,
        defaultPreview: {
          selectionKey: "default:draft.md",
          title: "draft.md",
          content: "主稿",
          filePath: "draft.md",
          absolutePath: "/workspace/draft.md",
          previousContent: "旧主稿",
        },
        entryMap,
        canvasState: null,
        artifacts: [previousArtifact, artifact],
        copy,
        workspaceRoot: "/workspace",
      }),
    ).toMatchObject({
      entrySource: "default-preview",
      title: "draft.md",
      content: "主稿",
      previousContent: "旧主稿",
      selectionPath: "/workspace/draft.md",
    });

    const artifactSelection = resolveSelectionContext({
      selectionKey: "artifact:artifact-current",
      defaultPreview: null,
      entryMap,
      canvasState: null,
      artifacts: [previousArtifact, artifact],
      copy,
    });
    expect(artifactSelection).toMatchObject({
      entrySource: "artifact",
      title: "draft.md",
      content: "当前产物",
      previousContent: "上一版产物",
      selectionPath: "draft.md",
    });
  });
});
