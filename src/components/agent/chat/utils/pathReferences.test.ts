import { afterEach, describe, expect, it } from "vitest";
import {
  buildPathReferenceRequestMetadata,
  clearRememberedPathReferencesForDrag,
  createPathReference,
  mergePathReferences,
  readCustomPathReferencesFromDataTransfer,
  rememberPathReferencesForDrag,
} from "./pathReferences";

describe("pathReferences", () => {
  afterEach(() => {
    clearRememberedPathReferencesForDrag();
  });

  it("应创建稳定路径引用并按路径去重", () => {
    const first = createPathReference({
      path: "/Users/demo/Downloads",
      isDir: true,
      source: "file_manager",
    });
    const duplicate = createPathReference({
      path: "/Users/demo/Downloads",
      name: "Downloads",
      isDir: true,
    });

    expect(first).toMatchObject({
      id: "dir:/Users/demo/Downloads",
      name: "Downloads",
      isDir: true,
    });
    expect(
      mergePathReferences(first ? [first] : [], duplicate ? [duplicate] : []),
    ).toHaveLength(1);
  });

  it("应把路径引用写入 request metadata 与 harness", () => {
    const reference = createPathReference({
      path: "C:/Users/demo/Downloads/report.pdf",
      name: "report.pdf",
      isDir: false,
      mimeType: "application/pdf",
      source: "system_drop",
    });

    expect(
      buildPathReferenceRequestMetadata(
        { harness: { theme: "general" } },
        reference ? [reference] : [],
      ),
    ).toMatchObject({
      path_references: [
        {
          path: "C:/Users/demo/Downloads/report.pdf",
          name: "report.pdf",
          is_dir: false,
          mime_type: "application/pdf",
        },
      ],
      harness: {
        theme: "general",
        file_references: [
          {
            path: "C:/Users/demo/Downloads/report.pdf",
            source: "system_drop",
          },
        ],
      },
    });
  });

  it("应在桌面 WebView 丢失自定义 DataTransfer MIME 时用本轮拖拽记忆兜底", () => {
    const reference = createPathReference({
      path: "/Users/demo/Downloads",
      name: "Downloads",
      isDir: true,
      source: "file_manager",
    });
    expect(reference).toBeTruthy();
    rememberPathReferencesForDrag(reference ? [reference] : []);

    const dataTransfer = {
      getData: (format: string) =>
        format === "text/plain" ? "/Users/demo/Downloads" : "",
    } as DataTransfer;

    expect(readCustomPathReferencesFromDataTransfer(dataTransfer)).toEqual([
      expect.objectContaining({
        path: "/Users/demo/Downloads",
        isDir: true,
        source: "file_manager",
      }),
    ]);

    clearRememberedPathReferencesForDrag();
  });
});
