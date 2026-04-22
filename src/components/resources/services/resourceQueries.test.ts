import { describe, expect, it } from "vitest";
import {
  canNavigateResourceFolderUp,
  getCategoryCounts,
  getCategoryScopedResources,
  getCurrentFolder,
  getFolderBreadcrumbs,
  getResourceCollectionSummary,
  getFolderScopedResources,
  getResourceMediaType,
} from "./resourceQueries";
import type { ResourceItem } from "./types";

function createResource(overrides: Partial<ResourceItem>): ResourceItem {
  return {
    id: "resource-id",
    projectId: "project-1",
    name: "资料",
    kind: "document",
    sourceType: "content",
    parentId: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("resourceQueries", () => {
  it("目录视图应共用同一套目录筛选与排序规则", () => {
    const rootFolder = createResource({
      id: "folder-1",
      kind: "folder",
      name: "参考资料",
      updatedAt: 3,
    });
    const rootDocument = createResource({
      id: "doc-1",
      name: "项目说明",
      updatedAt: 2,
    });
    const nestedDocument = createResource({
      id: "doc-2",
      name: "目录内说明",
      parentId: "folder-1",
      updatedAt: 4,
    });
    const rootFile = createResource({
      id: "file-1",
      kind: "file",
      sourceType: "material",
      name: "封面图.png",
      filePath: "/tmp/cover.png",
      mimeType: "image/png",
      updatedAt: 5,
    });

    const rootItems = getFolderScopedResources(
      [rootDocument, nestedDocument, rootFolder, rootFile],
      null,
      "",
      "updatedAt",
      "desc",
    );

    expect(rootItems.map((item) => item.id)).toEqual([
      "folder-1",
      "file-1",
      "doc-1",
    ]);

    const nestedItems = getFolderScopedResources(
      [rootDocument, nestedDocument, rootFolder, rootFile],
      "folder-1",
      "",
      "updatedAt",
      "desc",
    );

    expect(nestedItems.map((item) => item.id)).toEqual(["doc-2"]);
    expect(
      getCurrentFolder([rootDocument, nestedDocument, rootFolder], "folder-1")
        ?.id,
    ).toBe("folder-1");
    expect(
      getFolderBreadcrumbs(
        [
          createResource({
            id: "folder-root",
            kind: "folder",
            name: "根目录子级",
          }),
          createResource({
            id: "folder-child",
            kind: "folder",
            name: "子目录",
            parentId: "folder-root",
          }),
        ],
        "folder-child",
      ).map((item) => item.id),
    ).toEqual(["folder-root", "folder-child"]);
    expect(canNavigateResourceFolderUp("folder-1")).toBe(true);
    expect(canNavigateResourceFolderUp(null)).toBe(false);
  });

  it("分类视图应共用同一套媒体识别与聚合规则", () => {
    const imageItem = createResource({
      id: "image-1",
      kind: "file",
      sourceType: "material",
      name: "封面",
      filePath: "/tmp/cover.webp",
      mimeType: "image/webp",
      fileType: "image",
    });
    const audioItem = createResource({
      id: "audio-1",
      kind: "file",
      sourceType: "material",
      name: "旁白",
      filePath: "/tmp/voice.mp3",
      mimeType: "audio/mpeg",
    });
    const videoItem = createResource({
      id: "video-1",
      kind: "file",
      sourceType: "material",
      name: "样片",
      filePath: "/tmp/demo.mp4",
      mimeType: "video/mp4",
    });
    const documentItem = createResource({
      id: "doc-1",
      name: "脚本大纲",
    });

    expect(getResourceMediaType(imageItem)).toBe("image");
    expect(getResourceMediaType(audioItem)).toBe("audio");
    expect(getResourceMediaType(videoItem)).toBe("video");
    expect(getResourceMediaType(documentItem)).toBeNull();

    const imageItems = getCategoryScopedResources(
      [imageItem, audioItem, videoItem, documentItem],
      "image",
      "",
      "updatedAt",
      "desc",
    );
    expect(imageItems.map((item) => item.id)).toEqual(["image-1"]);

    const documentItems = getCategoryScopedResources(
      [imageItem, audioItem, videoItem, documentItem],
      "document",
      "",
      "updatedAt",
      "desc",
    );
    expect(documentItems.map((item) => item.id)).toEqual(["doc-1"]);

    expect(
      getCategoryCounts([imageItem, audioItem, videoItem, documentItem]),
    ).toEqual({
      all: 4,
      document: 1,
      image: 1,
      audio: 1,
      video: 1,
    });
  });

  it("项目摘要应共用同一套项目级统计派生规则", () => {
    const folderItem = createResource({
      id: "folder-1",
      kind: "folder",
      updatedAt: 2,
    });
    const documentItem = createResource({
      id: "doc-1",
      updatedAt: 5,
    });
    const fileItem = createResource({
      id: "file-1",
      kind: "file",
      sourceType: "material",
      updatedAt: 4,
    });

    expect(
      getResourceCollectionSummary([folderItem, documentItem, fileItem]),
    ).toEqual({
      folderCount: 1,
      contentItemCount: 2,
      latestUpdatedAt: 5,
    });

    expect(getResourceCollectionSummary([])).toEqual({
      folderCount: 0,
      contentItemCount: 0,
      latestUpdatedAt: null,
    });
  });
});
