import { describe, expect, it } from "vitest";
import type { DirectoryListing } from "@/lib/api/fileBrowser";
import { filterWorkspaceDirectoryListing } from "./workspaceTreeVisibility";

describe("workspaceTreeVisibility", () => {
  it("应在工作区根目录隐藏内部运行目录与旧 output 产物目录，但保留 exports", () => {
    const listing: DirectoryListing = {
      path: "/workspace",
      parentPath: null,
      error: null,
      entries: [
        {
          name: ".lime",
          path: "/workspace/.lime",
          isDir: true,
          size: 0,
          modifiedAt: 1,
        },
        {
          name: "exports",
          path: "/workspace/exports",
          isDir: true,
          size: 0,
          modifiedAt: 1,
        },
        {
          name: "output",
          path: "/workspace/output",
          isDir: true,
          size: 0,
          modifiedAt: 1,
        },
        {
          name: ".DS_Store",
          path: "/workspace/.DS_Store",
          isDir: false,
          size: 10,
          modifiedAt: 1,
        },
        {
          name: "output_image.jpg",
          path: "/workspace/output_image.jpg",
          isDir: false,
          size: 128,
          modifiedAt: 1,
        },
        {
          name: "README.md",
          path: "/workspace/README.md",
          isDir: false,
          size: 128,
          modifiedAt: 1,
        },
      ],
    };

    const filtered = filterWorkspaceDirectoryListing(listing, "/workspace");

    expect(filtered.entries.map((entry) => entry.name)).toEqual([
      "exports",
      "README.md",
    ]);
  });

  it("应保留普通嵌套目录内容，只隐藏全局系统文件", () => {
    const listing: DirectoryListing = {
      path: "/workspace/src",
      parentPath: "/workspace",
      error: null,
      entries: [
        {
          name: "exports",
          path: "/workspace/src/exports",
          isDir: true,
          size: 0,
          modifiedAt: 1,
        },
        {
          name: ".DS_Store",
          path: "/workspace/src/.DS_Store",
          isDir: false,
          size: 10,
          modifiedAt: 1,
        },
        {
          name: "main.ts",
          path: "/workspace/src/main.ts",
          isDir: false,
          size: 20,
          modifiedAt: 1,
        },
      ],
    };

    const filtered = filterWorkspaceDirectoryListing(listing, "/workspace");

    expect(filtered.entries.map((entry) => entry.name)).toEqual([
      "exports",
      "main.ts",
    ]);
  });
});
