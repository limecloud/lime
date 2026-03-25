import { describe, expect, it } from "vitest";

import {
  extractFilesystemEventLocationHints,
  extractFilesystemEventLocationHintsFromRecord,
  extractFilesystemEventLocationHintsFromValue,
  extractFilesystemEventPaths,
  extractFilesystemEventPathsFromRecord,
  extractFilesystemEventPathsFromValue,
} from "./index";

describe("filesystem-event-protocol", () => {
  it("应统一提取 snake_case 与 camelCase 的文件事件路径键", () => {
    expect(
      extractFilesystemEventPaths({
        file_path: " workspace\\draft.md ",
        fileName: "workspace/final.md",
        new_path: "workspace/next.md",
        paths: ["workspace/archive.md"],
      }),
    ).toEqual([
      "workspace/draft.md",
      "workspace/final.md",
      "workspace/next.md",
      "workspace/archive.md",
    ]);
  });

  it("应允许从未知 record 统一提取文件事件路径", () => {
    expect(
      extractFilesystemEventPathsFromRecord({
        filename: "workspace/demo.md",
        files: ["workspace\\cover.png"],
      }),
    ).toEqual(["workspace/demo.md", "workspace/cover.png"]);
    expect(extractFilesystemEventPathsFromRecord(null)).toEqual([]);
  });

  it("应递归提取嵌套对象中的文件事件路径", () => {
    expect(
      extractFilesystemEventPathsFromValue({
        payload: {
          newPath: "workspace\\next.md",
        },
        result: [
          {
            absolute_path: "/tmp/workspace/final.md",
          },
        ],
      }),
    ).toEqual(["workspace/next.md", "/tmp/workspace/final.md"]);
  });

  it("应统一提取目录与输出文件位置线索", () => {
    expect(
      extractFilesystemEventLocationHints({
        directory: "workspace\\docs",
        cwd: "/tmp/workspace",
        output_file: "workspace/result.log",
        offload_file: "workspace/offload.txt",
      }),
    ).toEqual([
      "workspace/docs",
      "/tmp/workspace",
      "workspace/result.log",
      "workspace/offload.txt",
    ]);
  });

  it("应允许从未知 record 与嵌套值提取位置线索", () => {
    expect(
      extractFilesystemEventLocationHintsFromRecord({
        cwd: "workspace\\root",
      }),
    ).toEqual(["workspace/root"]);
    expect(
      extractFilesystemEventLocationHintsFromValue({
        payload: {
          offload_file: "workspace\\full-output.txt",
        },
      }),
    ).toEqual(["workspace/full-output.txt"]);
  });
});
