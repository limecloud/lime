import React, { useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaTaskArtifactOutput } from "@/lib/api/mediaTasks";
import type {
  ReadLayeredDesignProjectExportOutput,
  SaveLayeredDesignProjectExportOutput,
} from "@/lib/api/layeredDesignProject";
import {
  createLayeredDesignFlatImageDraftDocument,
  createImageLayer,
  createSingleLayerAssetGenerationRequest,
  createTextLayer,
  recordLayeredDesignImageTaskSubmissions,
} from "@/lib/layered-design";
import type {
  GeneratedDesignAsset,
  LayeredDesignDocument,
} from "@/lib/layered-design";
import { createLayeredDesignDocument } from "@/lib/layered-design";
import { DesignCanvas } from "./DesignCanvas";
import type { DesignCanvasProps, DesignCanvasState } from "./types";

interface MountedCanvas {
  container: HTMLDivElement;
  root: Root;
  readState: () => DesignCanvasState;
}

const mountedCanvases: MountedCanvas[] = [];
const CREATED_AT = "2026-05-05T00:00:00.000Z";
const originalFileReader = globalThis.FileReader;

type DesignCanvasTestProps = Omit<
  Partial<DesignCanvasProps>,
  "state" | "onStateChange"
>;

function createAsset(id: string): GeneratedDesignAsset {
  return {
    id,
    kind: "subject",
    src: "",
    width: 512,
    height: 512,
    hasAlpha: true,
    provider: "test-provider",
    modelId: "test-model",
    createdAt: CREATED_AT,
  };
}

function createDocument(): LayeredDesignDocument {
  return createLayeredDesignDocument({
    id: "design-test",
    title: "图层化海报",
    canvas: { width: 1080, height: 1440, backgroundColor: "#f8fafc" },
    layers: [
      createImageLayer({
        id: "subject",
        name: "角色层",
        type: "image",
        assetId: "asset-subject",
        x: 120,
        y: 240,
        width: 640,
        height: 840,
        zIndex: 2,
        source: "generated",
      }),
      createTextLayer({
        id: "headline",
        name: "标题层",
        type: "text",
        text: "冥界女巫",
        x: 160,
        y: 120,
        width: 760,
        height: 140,
        zIndex: 8,
        source: "planned",
      }),
    ],
    assets: [createAsset("asset-subject")],
    preview: {
      assetId: "asset-preview",
      src: "/preview.png",
      width: 1080,
      height: 1440,
      updatedAt: CREATED_AT,
      stale: false,
    },
    createdAt: CREATED_AT,
  });
}

function createImageTaskOutput(
  taskId: string,
  result?: MediaTaskArtifactOutput["record"]["result"],
): MediaTaskArtifactOutput {
  return {
    success: true,
    task_id: taskId,
    task_type: "image_generate",
    task_family: "image",
    status: result ? "succeeded" : "pending_submit",
    normalized_status: result ? "succeeded" : "pending",
    path: `.lime/tasks/image_generate/${taskId}.json`,
    absolute_path: `/workspace/.lime/tasks/image_generate/${taskId}.json`,
    artifact_path: `.lime/tasks/image_generate/${taskId}.json`,
    absolute_artifact_path: `/workspace/.lime/tasks/image_generate/${taskId}.json`,
    reused_existing: false,
    record: {
      task_id: taskId,
      task_type: "image_generate",
      task_family: "image",
      payload: {
        prompt: "生成角色层",
        provider_id: "openai",
        model: "gpt-image-2",
      },
      status: result ? "succeeded" : "pending_submit",
      normalized_status: result ? "succeeded" : "pending",
      created_at: "2026-05-05T01:00:00.000Z",
      updated_at: "2026-05-05T01:00:00.000Z",
      result,
    },
  };
}

function createProjectExportOutput(
  fileCount: number,
  assetCount: number,
): SaveLayeredDesignProjectExportOutput {
  return {
    projectRootPath: "/workspace",
    exportDirectoryPath:
      "/workspace/.lime/layered-designs/design-test.layered-design",
    exportDirectoryRelativePath:
      ".lime/layered-designs/design-test.layered-design",
    designPath:
      "/workspace/.lime/layered-designs/design-test.layered-design/design.json",
    manifestPath:
      "/workspace/.lime/layered-designs/design-test.layered-design/export-manifest.json",
    previewPngPath:
      "/workspace/.lime/layered-designs/design-test.layered-design/preview.png",
    fileCount,
    assetCount,
    bytesWritten: 128,
  };
}

function createProjectExportReadOutput(
  designJson: string,
): ReadLayeredDesignProjectExportOutput {
  return {
    projectRootPath: "/workspace",
    exportDirectoryPath:
      "/workspace/.lime/layered-designs/restored-design.layered-design",
    exportDirectoryRelativePath:
      ".lime/layered-designs/restored-design.layered-design",
    designPath:
      "/workspace/.lime/layered-designs/restored-design.layered-design/design.json",
    designJson,
    manifestPath:
      "/workspace/.lime/layered-designs/restored-design.layered-design/export-manifest.json",
    manifestJson: "{\"assets\":[]}",
    previewPngPath:
      "/workspace/.lime/layered-designs/restored-design.layered-design/preview.png",
    fileCount: 5,
    assetCount: 0,
    updatedAtMs: 1778030000000,
  };
}

function StatefulCanvas({
  initialState,
  canvasProps = {},
}: {
  initialState: DesignCanvasState;
  canvasProps?: DesignCanvasTestProps;
}) {
  const [state, setState] = useState(initialState);
  (globalThis as typeof globalThis & { __designCanvasState?: DesignCanvasState })
    .__designCanvasState = state;

  return (
    <DesignCanvas state={state} onStateChange={setState} {...canvasProps} />
  );
}

function renderDesignCanvas(
  initialState: DesignCanvasState = {
    type: "design",
    document: createDocument(),
    selectedLayerId: "headline",
    zoom: 0.72,
  },
  canvasProps: DesignCanvasTestProps = {},
): MountedCanvas {
  const container = document.createElement("div");
  Object.defineProperty(container, "clientWidth", {
    configurable: true,
    value: 1200,
  });
  Object.defineProperty(container, "clientHeight", {
    configurable: true,
    value: 800,
  });
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <StatefulCanvas initialState={initialState} canvasProps={canvasProps} />,
    );
  });

  const mounted: MountedCanvas = {
    container,
    root,
    readState: () =>
      (globalThis as typeof globalThis & {
        __designCanvasState: DesignCanvasState;
      }).__designCanvasState,
  };
  mountedCanvases.push(mounted);
  return mounted;
}

function clickButton(label: string) {
  const button = Array.from(document.querySelectorAll("button")).find(
    (item) => item.textContent?.includes(label),
  );
  expect(button).toBeDefined();
  act(() => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function clickButtonAsync(label: string) {
  const button = Array.from(document.querySelectorAll("button")).find(
    (item) => item.textContent?.includes(label),
  );
  expect(button).toBeDefined();
  await act(async () => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

function createDocumentWithPendingImageTask(): LayeredDesignDocument {
  const document = createDocument();
  const generationRequest = createSingleLayerAssetGenerationRequest(
    document,
    "subject",
  );

  return recordLayeredDesignImageTaskSubmissions(
    document,
    [
      {
        generationRequest,
        taskRequest: {
          projectRootPath: "/workspace",
          prompt: generationRequest.prompt,
          title: "图层化海报 · 角色层",
          mode: "generate",
          size: "512x512",
          aspectRatio: "1:1",
          count: 1,
          entrySource: "layered_design_canvas",
          slotId: "subject",
          targetOutputId: "asset-subject",
          targetOutputRefId: generationRequest.id,
        },
        output: createImageTaskOutput("task-subject"),
      },
    ],
    { recordedAt: "2026-05-05T02:00:00.000Z" },
  );
}

function createFlatImageDraftDocument(): LayeredDesignDocument {
  return createLayeredDesignFlatImageDraftDocument({
    title: "扁平海报拆层",
    image: {
      src: "data:image/png;base64,ZmxhdA==",
      width: 1080,
      height: 1440,
      fileName: "flat-poster.png",
      mimeType: "image/png",
    },
    candidates: [
      {
        id: "subject-candidate",
        role: "subject",
        confidence: 0.92,
        layer: {
          id: "subject-layer",
          name: "人物主体",
          type: "image",
          assetId: "subject-asset",
          x: 120,
          y: 220,
          width: 760,
          height: 980,
          zIndex: 20,
          alphaMode: "embedded",
        },
        assets: [
          {
            id: "subject-asset",
            kind: "subject",
            src: "data:image/png;base64,c3ViamVjdA==",
            width: 760,
            height: 980,
            hasAlpha: true,
            createdAt: CREATED_AT,
          },
        ],
      },
      {
        id: "fragment-candidate",
        role: "background_fragment",
        confidence: 0.18,
        layer: {
          id: "fragment-layer",
          name: "边角碎片",
          type: "image",
          assetId: "fragment-asset",
          x: 32,
          y: 40,
          width: 120,
          height: 120,
          zIndex: 30,
          alphaMode: "embedded",
        },
        assets: [
          {
            id: "fragment-asset",
            kind: "effect",
            src: "data:image/png;base64,ZnJhZ21lbnQ=",
            width: 120,
            height: 120,
            hasAlpha: true,
            createdAt: CREATED_AT,
          },
        ],
      },
    ],
    cleanPlate: {
      status: "failed",
      message: "修补失败，保留原图背景。",
    },
    createdAt: CREATED_AT,
  });
}

class MockFlatImageFileReader {
  public onload:
    | ((event: { target: { result: string } }) => void)
    | null = null;
  public onerror: (() => void) | null = null;
  public error: Error | null = null;

  readAsDataURL(file: File) {
    queueMicrotask(() => {
      this.onload?.({
        target: {
          result: `data:${file.type || "image/png"};base64,ZmxhdC1pbWFnZQ==`,
        },
      });
    });
  }
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
      __designCanvasState?: DesignCanvasState;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  while (mountedCanvases.length > 0) {
    const mounted = mountedCanvases.pop();
    if (!mounted) break;
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  delete (globalThis as { __designCanvasState?: DesignCanvasState })
    .__designCanvasState;
  globalThis.FileReader = originalFileReader;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("DesignCanvas", () => {
  it("应渲染图层栏、画布和属性栏，并展示 LayeredDesignDocument 信息", () => {
    renderDesignCanvas();

    expect(document.body.textContent).toContain("LayeredDesignDocument");
    expect(document.body.textContent).toContain("图层化海报");
    expect(document.body.textContent).toContain("角色层");
    expect(document.body.textContent).toContain("标题层");
    expect(document.body.textContent).toContain("1080 x 1440");
  });

  it("应暴露 design.json、PSD-like manifest、preview 和 assets 的工程导出入口", () => {
    renderDesignCanvas();

    expect(document.body.textContent).toContain("导出设计工程");
    expect(document.body.textContent).not.toContain("PNG 导出待接入");
  });

  it("导出设计工程应下载单个 ZIP，而不是散落下载多个文件", async () => {
    const downloads: string[] = [];
    const originalCreateElement = document.createElement.bind(document);
    const createObjectUrlMock = vi.fn(() => "blob:design-zip");
    const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(
      URL,
      "createObjectURL",
    );
    const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(
      URL,
      "revokeObjectURL",
    );

    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrlMock,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(document, "createElement").mockImplementation(
      ((tagName: string) => {
        const element = originalCreateElement(tagName);

        if (tagName.toLowerCase() === "canvas") {
          Object.defineProperty(element, "getContext", {
            configurable: true,
            value: () => ({ drawImage: vi.fn() }),
          });
          Object.defineProperty(element, "toDataURL", {
            configurable: true,
            value: () => "data:image/png;base64,cHJldmlldy1wbmc=",
          });
        }

        if (tagName.toLowerCase() === "a") {
          Object.defineProperty(element, "click", {
            configurable: true,
            value: () => {
              downloads.push((element as HTMLAnchorElement).download);
            },
          });
        }

        return element;
      }) as typeof document.createElement,
    );
    try {
      vi.stubGlobal(
        "Image",
        class {
          onload: (() => void) | null = null;
          onerror: (() => void) | null = null;

          set src(_value: string) {
            queueMicrotask(() => this.onload?.());
          }
        },
      );
      renderDesignCanvas();

      await clickButtonAsync("导出设计工程");

      expect(downloads).toEqual(["design-test.layered-design.zip"]);
      expect(createObjectUrlMock).toHaveBeenCalledTimes(1);
      expect(document.body.textContent).toContain("已下载 ZIP 工程包");
    } finally {
      if (createObjectUrlDescriptor) {
        Object.defineProperty(URL, "createObjectURL", createObjectUrlDescriptor);
      } else {
        const mutableUrl = URL as Omit<typeof URL, "createObjectURL"> & {
          createObjectURL?: unknown;
        };
        delete mutableUrl.createObjectURL;
      }

      if (revokeObjectUrlDescriptor) {
        Object.defineProperty(URL, "revokeObjectURL", revokeObjectUrlDescriptor);
      } else {
        const mutableUrl = URL as Omit<typeof URL, "revokeObjectURL"> & {
          revokeObjectURL?: unknown;
        };
        delete mutableUrl.revokeObjectURL;
      }
    }
  });

  it("上传扁平图应创建 extraction draft 并切换到当前 DesignCanvas", async () => {
    globalThis.FileReader = MockFlatImageFileReader as never;
    vi.stubGlobal(
      "Image",
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        naturalWidth = 900;
        naturalHeight = 1400;
        width = 900;
        height = 1400;

        set src(_value: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    const originalCreateElement = document.createElement.bind(document);
    let cropIndex = 0;
    vi.spyOn(document, "createElement").mockImplementation(
      ((tagName: string) => {
        const element = originalCreateElement(tagName);

        if (tagName.toLowerCase() === "canvas") {
          Object.defineProperty(element, "getContext", {
            configurable: true,
            value: () => ({ drawImage: vi.fn() }),
          });
          Object.defineProperty(element, "toDataURL", {
            configurable: true,
            value: () =>
              `data:image/png;base64,ZGVzaWduLWNhbnZhcy1oZXVyaXN0aWMt${++cropIndex}`,
          });
        }

        return element;
      }) as typeof document.createElement,
    );

    const mounted = renderDesignCanvas();
    const input = mounted.container.querySelector(
      '[data-testid="design-canvas-flat-image-input"]',
    ) as HTMLInputElement | null;
    expect(input).toBeTruthy();

    const file = new File(["flat"], "teaser-poster.png", {
      type: "image/png",
    });

    await act(async () => {
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [file],
      });
      input?.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mounted.readState().document.title).toBe("teaser-poster");
    expect(mounted.readState().document.layers.map((layer) => layer.id)).toEqual(
      ["extraction-background-image", "subject-layer", "headline-layer"],
    );
    expect(mounted.readState().selectedLayerId).toBe("headline-layer");
    expect(mounted.readState().document.extraction).toMatchObject({
      sourceAssetId: "teaser-poster-source-image",
      cleanPlate: {
        status: "not_requested",
        message: "当前候选来自本地 heuristic 裁片；尚未执行 clean plate。",
      },
      candidates: [
        {
          id: "subject-candidate",
          selected: true,
        },
        {
          id: "headline-candidate",
          selected: true,
        },
        {
          id: "logo-candidate",
          selected: false,
          issues: ["low_confidence"],
        },
        {
          id: "fragment-candidate",
          selected: false,
          issues: ["low_confidence"],
        },
      ],
    });
    expect(mounted.readState().document.assets[0]).toMatchObject({
      kind: "source_image",
      src: "data:image/png;base64,ZmxhdC1pbWFnZQ==",
    });
    expect(document.body.textContent).toContain("本地 heuristic 候选层");
    expect(JSON.stringify(mounted.readState().document)).not.toMatch(
      /poster_generate|canvas:poster|ImageTaskViewer/,
    );
  });

  it("拆层候选切换应只把选中候选 materialize 到正式图层", () => {
    const mounted = renderDesignCanvas(
      {
        type: "design",
        document: createFlatImageDraftDocument(),
        selectedLayerId: "subject-layer",
        zoom: 0.72,
      },
      {},
    );

    expect(document.body.textContent).toContain("拆层候选");
    expect(document.body.textContent).toContain("边角碎片");
    expect(
      mounted.readState().document.layers.some(
        (layer) => layer.id === "fragment-layer",
      ),
    ).toBe(false);

    clickButton("边角碎片");

    expect(
      mounted.readState().document.layers.some(
        (layer) => layer.id === "fragment-layer",
      ),
    ).toBe(true);
    expect(
      mounted.readState().document.extraction?.candidates.find(
        (candidate) => candidate.id === "fragment-candidate",
      ),
    ).toMatchObject({
      selected: true,
      issues: ["low_confidence"],
    });
    expect(mounted.readState().document.editHistory.at(-1)?.type).toBe(
      "candidate_selection_updated",
    );
  });

  it("绑定工作区时应把设计工程保存到项目目录，而不是触发浏览器下载", async () => {
    const saveProjectExport = vi
      .fn()
      .mockResolvedValue(createProjectExportOutput(6, 1));
    const createObjectUrlMock = vi.fn(() => "blob:should-not-download");
    const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(
      URL,
      "createObjectURL",
    );
    const originalCreateElement = document.createElement.bind(document);
    const downloads: string[] = [];

    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrlMock,
    });
    vi.spyOn(document, "createElement").mockImplementation(
      ((tagName: string) => {
        const element = originalCreateElement(tagName);

        if (tagName.toLowerCase() === "canvas") {
          Object.defineProperty(element, "getContext", {
            configurable: true,
            value: () => ({ drawImage: vi.fn() }),
          });
          Object.defineProperty(element, "toDataURL", {
            configurable: true,
            value: () => "data:image/png;base64,cHJldmlldy1wbmc=",
          });
        }

        if (tagName.toLowerCase() === "a") {
          Object.defineProperty(element, "click", {
            configurable: true,
            value: () => {
              downloads.push((element as HTMLAnchorElement).download);
            },
          });
        }

        return element;
      }) as typeof document.createElement,
    );

    try {
      vi.stubGlobal(
        "Image",
        class {
          onload: (() => void) | null = null;
          onerror: (() => void) | null = null;

          set src(_value: string) {
            queueMicrotask(() => this.onload?.());
          }
        },
      );

      const documentWithEmbeddedAsset = createDocument();
      renderDesignCanvas(
        {
          type: "design",
          document: {
            ...documentWithEmbeddedAsset,
            assets: documentWithEmbeddedAsset.assets.map((asset) =>
              asset.id === "asset-subject"
                ? { ...asset, src: "data:image/png;base64,YXNzZXQtcG5n" }
                : asset,
            ),
          },
          selectedLayerId: "headline",
          zoom: 0.72,
        },
        {
          projectRootPath: "/workspace",
          saveProjectExport,
        },
      );

      await clickButtonAsync("导出设计工程");

      expect(saveProjectExport).toHaveBeenCalledWith(
        expect.objectContaining({
          projectRootPath: "/workspace",
          documentId: "design-test",
          title: "图层化海报",
          directoryName: "design-test.layered-design",
          files: expect.arrayContaining([
            expect.objectContaining({
              relativePath: "design.json",
              encoding: "utf8",
            }),
            expect.objectContaining({
              relativePath: "psd-like-manifest.json",
              encoding: "utf8",
            }),
            expect.objectContaining({
              relativePath: "preview.png",
              encoding: "base64",
            }),
            expect.objectContaining({
              relativePath: "assets/asset-subject.png",
              encoding: "base64",
            }),
          ]),
        }),
      );
      expect(JSON.stringify(saveProjectExport.mock.calls[0][0])).not.toMatch(
        /poster_generate|canvas:poster|ImageTaskViewer/,
      );
      expect(downloads).toEqual([]);
      expect(createObjectUrlMock).not.toHaveBeenCalled();
      expect(document.body.textContent).toContain("已保存图层设计工程");
    } finally {
      if (createObjectUrlDescriptor) {
        Object.defineProperty(URL, "createObjectURL", createObjectUrlDescriptor);
      } else {
        const mutableUrl = URL as Omit<typeof URL, "createObjectURL"> & {
          createObjectURL?: unknown;
        };
        delete mutableUrl.createObjectURL;
      }
    }
  });

  it("打开最近工程应从项目目录恢复 LayeredDesignDocument 并继续编辑", async () => {
    const restoredDocument = createLayeredDesignDocument({
      id: "restored-design",
      title: "恢复的图层设计",
      canvas: { width: 1200, height: 900, backgroundColor: "#eef2ff" },
      layers: [
        createTextLayer({
          id: "restored-headline",
          name: "恢复标题",
          type: "text",
          text: "继续编辑",
          x: 80,
          y: 90,
          width: 640,
          height: 120,
          zIndex: 5,
          source: "planned",
        }),
      ],
      assets: [],
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });
    const readProjectExport = vi
      .fn()
      .mockResolvedValue(
        createProjectExportReadOutput(JSON.stringify(restoredDocument)),
      );
    const mounted = renderDesignCanvas(undefined, {
      projectRootPath: "/workspace",
      readProjectExport,
    });

    await clickButtonAsync("打开最近工程");

    expect(readProjectExport).toHaveBeenCalledWith({
      projectRootPath: "/workspace",
    });
    expect(mounted.readState().document).toMatchObject({
      id: "restored-design",
      title: "恢复的图层设计",
      canvas: expect.objectContaining({ width: 1200, height: 900 }),
    });
    expect(mounted.readState().selectedLayerId).toBe("restored-headline");
    expect(document.body.textContent).toContain("已打开图层设计工程");
    expect(JSON.stringify(mounted.readState().document)).not.toMatch(
      /poster_generate|canvas:poster|ImageTaskViewer/,
    );
  });

  it("移动图层应回写 LayeredDesignDocument，并把 preview 标记为 stale", () => {
    const mounted = renderDesignCanvas();

    clickButton("右移");

    const updatedLayer = mounted
      .readState()
      .document.layers.find((layer) => layer.id === "headline");
    expect(updatedLayer?.x).toBe(170);
    expect(mounted.readState().document.preview?.stale).toBe(true);
    expect(mounted.readState().document.editHistory.at(-1)?.type).toBe(
      "transform_updated",
    );
  });

  it("隐藏图层应回写文档 visible 状态，而不是只隐藏前端 DOM", () => {
    const mounted = renderDesignCanvas();

    clickButton("隐藏");

    const updatedLayer = mounted
      .readState()
      .document.layers.find((layer) => layer.id === "headline");
    expect(updatedLayer?.visible).toBe(false);
    expect(mounted.readState().document.editHistory.at(-1)).toMatchObject({
      type: "visibility_updated",
      layerId: "headline",
      previousVisible: true,
      nextVisible: false,
    });
  });

  it("生成全部图片层应提交现有 image task，并把请求记录回文档", async () => {
    const createImageTaskArtifact = vi
      .fn()
      .mockResolvedValue(createImageTaskOutput("task-subject"));
    const mounted = renderDesignCanvas(undefined, {
      projectRootPath: "/workspace",
      projectId: "project-1",
      contentId: "content-1",
      createImageTaskArtifact,
    });

    await clickButtonAsync("生成全部图片层");

    expect(createImageTaskArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRootPath: "/workspace",
        entrySource: "layered_design_canvas",
        modalityContractKey: "image_generation",
        routingSlot: "image_generation_model",
        slotId: "subject",
        targetOutputId: "asset-subject",
        targetOutputRefId: "design-test:subject:asset-subject",
        projectId: "project-1",
        contentId: "content-1",
      }),
    );
    expect(JSON.stringify(createImageTaskArtifact.mock.calls[0][0])).not.toMatch(
      /poster_generate|canvas:poster/,
    );
    expect(mounted.readState().document.editHistory.at(-1)).toMatchObject({
      type: "asset_generation_requested",
      layerId: "subject",
      nextAssetId: "asset-subject",
    });
    expect(document.body.textContent).toContain("已提交 1 个图片任务");
  });

  it("重生成当前图片层应写回生成资产，并保持文字层可编辑", async () => {
    const createImageTaskArtifact = vi.fn().mockResolvedValue(
      createImageTaskOutput("task-subject", {
        images: [
          {
            url: "data:image/png;base64,ZmFrZS1zdWJqZWN0",
            revised_prompt: "重生成角色层",
          },
        ],
      }),
    );
    const mounted = renderDesignCanvas(
      {
        type: "design",
        document: createDocument(),
        selectedLayerId: "subject",
        zoom: 0.72,
      },
      {
        projectRootPath: "/workspace",
        createImageTaskArtifact,
      },
    );

    await clickButtonAsync("重生成当前层");

    const updatedState = mounted.readState();
    expect(
      updatedState.document.layers.find((layer) => layer.id === "subject"),
    ).toMatchObject({
      type: "image",
      assetId: "asset-subject-generated-task-subject",
      source: "generated",
      x: 120,
      y: 240,
      width: 640,
      height: 840,
    });
    expect(
      updatedState.document.layers.find((layer) => layer.id === "headline"),
    ).toMatchObject({
      type: "text",
      text: "冥界女巫",
    });
    expect(updatedState.document.assets.at(-1)).toMatchObject({
      id: "asset-subject-generated-task-subject",
      src: "data:image/png;base64,ZmFrZS1zdWJqZWN0",
      provider: "openai",
      modelId: "gpt-image-2",
    });
    expect(document.body.textContent).toContain("写回 1 个已完成结果");
  });

  it("刷新生成结果应恢复已提交任务，并把成功输出写回目标图片层", async () => {
    const getImageTaskArtifact = vi.fn().mockResolvedValue(
      createImageTaskOutput("task-subject", {
        images: [
          {
            url: "data:image/png;base64,cmVmcmVzaGVk",
            revised_prompt: "刷新回来的角色层",
          },
        ],
      }),
    );
    const mounted = renderDesignCanvas(
      {
        type: "design",
        document: createDocumentWithPendingImageTask(),
        selectedLayerId: "subject",
        zoom: 0.72,
      },
      {
        projectRootPath: "/workspace",
        getImageTaskArtifact,
      },
    );

    await clickButtonAsync("刷新生成结果");

    expect(getImageTaskArtifact).toHaveBeenCalledWith({
      projectRootPath: "/workspace",
      taskRef: ".lime/tasks/image_generate/task-subject.json",
    });
    expect(
      mounted
        .readState()
        .document.layers.find((layer) => layer.id === "subject"),
    ).toMatchObject({
      type: "image",
      assetId: "asset-subject-generated-task-subject",
      source: "generated",
    });
    expect(
      mounted
        .readState()
        .document.layers.find((layer) => layer.id === "headline"),
    ).toMatchObject({
      type: "text",
      text: "冥界女巫",
    });
    expect(document.body.textContent).toContain(
      "已刷新 1 个图片任务，并写回 1 个图层结果",
    );
    expect(JSON.stringify(mounted.readState().document)).not.toMatch(
      /poster_generate|canvas:poster/,
    );
  });
});
