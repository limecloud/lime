import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockConvertLocalFileSrc } = vi.hoisted(() => ({
  mockConvertLocalFileSrc: vi.fn((path: string) => `asset://${path}`),
}));

vi.mock("@/lib/api/fileSystem", () => ({
  convertLocalFileSrc: mockConvertLocalFileSrc,
}));

import {
  RESOURCE_MANAGER_ACTIVE_SESSION_KEY,
  RESOURCE_MANAGER_SESSION_TTL_MS,
  buildResourceManagerSession,
  getResourceManagerSessionStorageKey,
  inferResourceManagerKind,
  normalizeResourceManagerSourceContext,
  normalizeResourceManagerSrc,
  readResourceManagerSession,
  writeResourceManagerSession,
} from "./resourceManagerSession";

describe("resourceManagerSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("应把本地路径转换成 WebView 可加载地址", () => {
    expect(normalizeResourceManagerSrc("/tmp/demo.png")).toBe(
      "asset:///tmp/demo.png",
    );
    expect(mockConvertLocalFileSrc).toHaveBeenCalledWith("/tmp/demo.png");
  });

  it("应根据扩展名和 MIME 识别资源类型", () => {
    expect(inferResourceManagerKind({ filePath: "/tmp/a.pdf" })).toBe("pdf");
    expect(inferResourceManagerKind({ filePath: "/tmp/a.md" })).toBe(
      "markdown",
    );
    expect(inferResourceManagerKind({ filePath: "/tmp/a.docx" })).toBe(
      "office",
    );
    expect(inferResourceManagerKind({ filePath: "/tmp/a.pptm" })).toBe(
      "office",
    );
    expect(inferResourceManagerKind({ filePath: "/tmp/a.odt" })).toBe("office");
    expect(inferResourceManagerKind({ filePath: "/tmp/a.fodt" })).toBe(
      "office",
    );
    expect(inferResourceManagerKind({ filePath: "/tmp/a.key" })).toBe("office");
    expect(
      inferResourceManagerKind({
        mimeType: "application/vnd.apple.keynote",
      }),
    ).toBe("office");
    expect(inferResourceManagerKind({ filePath: "/tmp/a.heic" })).toBe("image");
    expect(inferResourceManagerKind({ filePath: "/tmp/a.jxl" })).toBe("image");
    expect(inferResourceManagerKind({ filePath: "/tmp/a.dng" })).toBe("image");
    expect(inferResourceManagerKind({ filePath: "/tmp/a.m2ts" })).toBe("video");
    expect(inferResourceManagerKind({ filePath: "/tmp/a.opus" })).toBe("audio");
    expect(inferResourceManagerKind({ filePath: "/tmp/a.mdx" })).toBe(
      "markdown",
    );
    expect(inferResourceManagerKind({ filePath: "/tmp/a.jsonl" })).toBe("data");
    expect(
      inferResourceManagerKind({
        filePath: "/tmp/a.csv",
        mimeType: "text/plain",
      }),
    ).toBe("data");
    expect(inferResourceManagerKind({ filePath: "/tmp/a.zip" })).toBe(
      "archive",
    );
    expect(inferResourceManagerKind({ filePath: "/tmp/a.tar.gz" })).toBe(
      "archive",
    );
    expect(
      inferResourceManagerKind({ mimeType: "application/x-7z-compressed" }),
    ).toBe("archive");
    expect(inferResourceManagerKind({ filePath: "/tmp/a.ts" })).toBe("text");
    expect(inferResourceManagerKind({ mimeType: "video/mp4" })).toBe("video");
    expect(inferResourceManagerKind({ content: "# 标题" })).toBe("markdown");
  });

  it("应写入并读取资源管理器会话", () => {
    const session = buildResourceManagerSession({
      items: [
        {
          src: "/tmp/demo.pdf",
          filePath: "/tmp/demo.pdf",
          title: "本地 PDF",
        },
      ],
      initialIndex: 3,
      sourceLabel: "测试来源",
      sourceContext: {
        kind: "project_resource",
        projectId: "project-1",
        contentId: "content-1",
        sourcePage: "resources",
        resourceFolderId: "folder-1",
        resourceCategory: "document",
      },
    });

    expect(session).toBeTruthy();
    writeResourceManagerSession(session!);

    expect(localStorage.getItem(RESOURCE_MANAGER_ACTIVE_SESSION_KEY)).toBe(
      session!.id,
    );
    expect(readResourceManagerSession(session!.id)).toEqual(
      expect.objectContaining({
        id: session!.id,
        initialIndex: 0,
        sourceLabel: "测试来源",
        sourceContext: expect.objectContaining({
          kind: "project_resource",
          projectId: "project-1",
          contentId: "content-1",
          resourceFolderId: "folder-1",
          resourceCategory: "document",
        }),
        items: [
          expect.objectContaining({
            kind: "pdf",
            src: "asset:///tmp/demo.pdf",
            filePath: "/tmp/demo.pdf",
            sourceContext: expect.objectContaining({
              kind: "project_resource",
              projectId: "project-1",
              contentId: "content-1",
              resourceFolderId: "folder-1",
              resourceCategory: "document",
            }),
          }),
        ],
      }),
    );
  });

  it("应归一化业务来源上下文并允许资源项覆盖会话上下文", () => {
    expect(
      normalizeResourceManagerSourceContext({
        kind: "image_task",
        taskId: " task-1 ",
        outputId: "",
        ignored: "legacy",
      }),
    ).toEqual({
      kind: "image_task",
      taskId: "task-1",
    });
    expect(
      normalizeResourceManagerSourceContext({ kind: "media_viewer" }),
    ).toBeNull();

    const session = buildResourceManagerSession({
      sourceContext: {
        kind: "project_resource",
        projectId: "project-1",
        contentId: "content-session",
      },
      items: [
        {
          src: "https://example.com/a.png",
          kind: "image",
          sourceContext: {
            kind: "image_task",
            taskId: "task-1",
            outputId: "output-1",
          },
        },
      ],
    });

    expect(session?.items[0]?.sourceContext).toEqual(
      expect.objectContaining({
        kind: "image_task",
        taskId: "task-1",
        outputId: "output-1",
      }),
    );
  });

  it("应忽略过期或非法会话", () => {
    const sessionId = "expired-session";
    localStorage.setItem(
      getResourceManagerSessionStorageKey(sessionId),
      JSON.stringify({
        id: sessionId,
        items: [],
        initialIndex: 0,
        createdAt: Date.now() - RESOURCE_MANAGER_SESSION_TTL_MS - 1,
      }),
    );

    expect(readResourceManagerSession(sessionId)).toBeNull();
    expect(
      localStorage.getItem(getResourceManagerSessionStorageKey(sessionId)),
    ).toBeNull();

    localStorage.setItem(getResourceManagerSessionStorageKey("bad"), "{");
    expect(readResourceManagerSession("bad")).toBeNull();
  });
});
