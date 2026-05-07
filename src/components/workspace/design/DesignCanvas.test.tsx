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
  AnalyzeLayeredDesignFlatImage,
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
const SUBJECT_MODEL_SLOT_EXECUTION = {
  slotId: "subject-runtime",
  slotKind: "subject_matting",
  providerLabel: "Runtime subject matting",
  modelId: "runtime-matting-v1",
  execution: "remote_model",
  attempt: 1,
  maxAttempts: 1,
  timeoutMs: 45_000,
  fallbackStrategy: "return_null",
  fallbackUsed: false,
  status: "succeeded",
};
const CLEAN_PLATE_MODEL_SLOT_EXECUTION = {
  slotId: "clean-runtime",
  slotKind: "clean_plate",
  providerLabel: "Runtime clean plate",
  modelId: "runtime-inpaint-v1",
  execution: "remote_model",
  attempt: 2,
  maxAttempts: 2,
  timeoutMs: 45_000,
  fallbackStrategy: "return_null",
  fallbackUsed: false,
  status: "succeeded",
};
const OCR_MODEL_SLOT_EXECUTION = {
  slotId: "ocr-runtime",
  slotKind: "text_ocr",
  providerLabel: "Runtime OCR",
  modelId: "runtime-ocr-v1",
  execution: "remote_model",
  attempt: 1,
  maxAttempts: 1,
  timeoutMs: 45_000,
  fallbackStrategy: "use_heuristic",
  fallbackUsed: true,
  status: "fallback_succeeded",
};
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

function changeInputValue(ariaLabel: string, value: string) {
  const input = document.querySelector(
    `input[aria-label="${ariaLabel}"]`,
  ) as HTMLInputElement | null;

  expect(input).not.toBeNull();
  if (!input) {
    throw new Error(`未找到输入框：${ariaLabel}`);
  }

  act(() => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    valueSetter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function dispatchPointerEvent(
  element: Element,
  type: string,
  options: {
    pointerId?: number;
    clientX: number;
    clientY: number;
  },
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: options.clientX,
    clientY: options.clientY,
  });
  Object.defineProperty(event, "pointerId", {
    configurable: true,
    value: options.pointerId ?? 1,
  });

  act(() => {
    element.dispatchEvent(event);
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

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function waitForCanvasState(
  condition: () => boolean,
  errorMessage: string,
  timeout = 80,
) {
  for (let index = 0; index < timeout; index += 1) {
    if (condition()) {
      await flushEffects();
      return;
    }

    await flushEffects();
  }

  throw new Error(errorMessage);
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
    analysis: {
      analyzer: {
        kind: "local_heuristic",
        label: "本地 heuristic analyzer",
      },
      outputs: {
        candidateRaster: true,
        candidateMask: false,
        cleanPlate: false,
        ocrText: false,
      },
      generatedAt: CREATED_AT,
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
            params: {
              modelSlotExecution: SUBJECT_MODEL_SLOT_EXECUTION,
            },
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

function createFlatImageDraftDocumentWithCleanPlate(): LayeredDesignDocument {
  return createLayeredDesignFlatImageDraftDocument({
    title: "带修补背景的扁平海报",
    image: {
      src: "data:image/png;base64,ZmxhdC1jbGVhbg==",
      width: 1080,
      height: 1440,
      fileName: "flat-clean-poster.png",
      mimeType: "image/png",
    },
    analysis: {
      analyzer: {
        kind: "local_heuristic",
        label: "测试 clean plate analyzer",
      },
      outputs: {
        candidateRaster: true,
        candidateMask: false,
        cleanPlate: true,
        ocrText: false,
      },
      providerCapabilities: [
        {
          kind: "clean_plate",
          label: "Simple browser clean plate provider",
          execution: "browser_worker",
          modelId: "simple_neighbor_inpaint_v1",
          supports: {
            dataUrlPng: true,
            maskInput: true,
            cleanPlateOutput: true,
          },
          quality: {
            productionReady: false,
            deterministic: true,
            requiresHumanReview: true,
          },
        },
      ],
      generatedAt: CREATED_AT,
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
            src: "data:image/png;base64,c3ViamVjdC1jbGVhbg==",
            width: 760,
            height: 980,
            hasAlpha: true,
            createdAt: CREATED_AT,
            params: {
              modelSlotExecution: SUBJECT_MODEL_SLOT_EXECUTION,
            },
          },
        ],
      },
    ],
    cleanPlate: {
      status: "succeeded",
      asset: {
        id: "clean-plate-asset",
        kind: "clean_plate",
        src: "data:image/png;base64,Y2xlYW4tcGxhdGU=",
        width: 1080,
        height: 1440,
        hasAlpha: false,
        createdAt: CREATED_AT,
        params: {
          seed: "worker_heuristic_clean_plate_provider",
          provider: "测试 clean plate provider",
          model: "fixture-inpaint",
          modelSlotExecution: CLEAN_PLATE_MODEL_SLOT_EXECUTION,
        },
      },
      message: "背景修补可用。",
    },
    createdAt: CREATED_AT,
  });
}

function createFlatImageDraftDocumentWithMaskAndTextCandidate(): LayeredDesignDocument {
  return createLayeredDesignFlatImageDraftDocument({
    title: "带 mask 和 OCR 文字候选的扁平海报",
    image: {
      src: "data:image/png;base64,ZmxhdC1tYXNrLW9jcg==",
      width: 1080,
      height: 1440,
      fileName: "flat-mask-ocr-poster.png",
      mimeType: "image/png",
    },
    analysis: {
      analyzer: {
        kind: "local_heuristic",
        label: "测试 mask + OCR analyzer",
      },
      outputs: {
        candidateRaster: true,
        candidateMask: true,
        cleanPlate: false,
        ocrText: true,
      },
      generatedAt: CREATED_AT,
    },
    candidates: [
      {
        id: "subject-candidate",
        role: "subject",
        confidence: 0.91,
        layer: {
          id: "subject-layer",
          name: "人物主体",
          type: "image",
          assetId: "subject-asset",
          maskAssetId: "subject-mask",
          x: 120,
          y: 220,
          width: 760,
          height: 980,
          zIndex: 20,
          alphaMode: "mask",
        },
        assets: [
          {
            id: "subject-asset",
            kind: "subject",
            src: "data:image/png;base64,c3ViamVjdC1tYXNrLW9jcg==",
            width: 760,
            height: 980,
            hasAlpha: true,
            createdAt: CREATED_AT,
          },
          {
            id: "subject-mask",
            kind: "mask",
            src: "data:image/png;base64,bWFzay1vY3I=",
            width: 760,
            height: 980,
            hasAlpha: false,
            createdAt: CREATED_AT,
          },
        ],
      },
      {
        id: "headline-candidate",
        role: "text",
        confidence: 0.88,
        layer: createTextLayer({
          id: "headline-layer",
          name: "标题文案",
          type: "text",
          text: "霓虹开幕",
          x: 148,
          y: 104,
          width: 720,
          height: 156,
          zIndex: 38,
          fontSize: 72,
          color: "#f97316",
          align: "center",
          source: "extracted",
          params: {
            modelSlotExecution: OCR_MODEL_SLOT_EXECUTION,
          },
        }),
      },
    ],
    cleanPlate: {
      status: "not_requested",
      message: "当前 analyzer 未生成 clean plate。",
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
            value: () => "data:image/png;base64,ZGVzaWduLWNhbnZhcy1oZXVyaXN0aWM=",
          });
        }

        return element;
      }) as typeof document.createElement,
    );
    const analyzeFlatImage: AnalyzeLayeredDesignFlatImage = vi
      .fn()
      .mockResolvedValue({
        analysis: {
          analyzer: {
            kind: "local_heuristic",
            label: "本地 heuristic analyzer",
          },
          outputs: {
            candidateRaster: true,
            candidateMask: false,
            cleanPlate: false,
            ocrText: false,
          },
          generatedAt: CREATED_AT,
        },
        cleanPlate: {
          status: "not_requested",
          message: "当前候选来自本地 heuristic 裁片；尚未执行 clean plate。",
        },
        candidates: [
          {
            id: "subject-candidate",
            role: "subject",
            confidence: 0.74,
            layer: {
              id: "subject-layer",
              name: "主体候选",
              type: "image",
              assetId: "subject-asset",
              x: 144,
              y: 224,
              width: 612,
              height: 980,
              zIndex: 20,
              alphaMode: "embedded",
            },
            assets: [
              {
                id: "subject-asset",
                kind: "subject",
                src: "data:image/png;base64,c3ViamVjdA==",
                width: 612,
                height: 980,
                hasAlpha: false,
                createdAt: CREATED_AT,
              },
            ],
          },
          {
            id: "headline-candidate",
            role: "text",
            confidence: 0.62,
            layer: {
              id: "headline-layer",
              name: "标题文字候选",
              type: "image",
              assetId: "headline-asset",
              x: 108,
              y: 84,
              width: 684,
              height: 252,
              zIndex: 40,
              alphaMode: "embedded",
            },
            assets: [
              {
                id: "headline-asset",
                kind: "text_raster",
                src: "data:image/png;base64,aGVhZGxpbmU=",
                width: 684,
                height: 252,
                hasAlpha: false,
                createdAt: CREATED_AT,
              },
            ],
          },
          {
            id: "logo-candidate",
            role: "logo",
            confidence: 0.48,
            issues: ["low_confidence"],
            layer: {
              id: "logo-layer",
              name: "Logo 候选",
              type: "image",
              assetId: "logo-asset",
              x: 54,
              y: 84,
              width: 252,
              height: 224,
              zIndex: 48,
              alphaMode: "embedded",
            },
            assets: [
              {
                id: "logo-asset",
                kind: "logo",
                src: "data:image/png;base64,bG9nbw==",
                width: 252,
                height: 224,
                hasAlpha: false,
                createdAt: CREATED_AT,
              },
            ],
          },
          {
            id: "fragment-candidate",
            role: "background_fragment",
            confidence: 0.22,
            issues: ["low_confidence"],
            layer: {
              id: "fragment-layer",
              name: "边角碎片",
              type: "effect",
              assetId: "fragment-asset",
              x: 648,
              y: 1008,
              width: 198,
              height: 308,
              zIndex: 56,
              alphaMode: "embedded",
            },
            assets: [
              {
                id: "fragment-asset",
                kind: "effect",
                src: "data:image/png;base64,ZnJhZ21lbnQ=",
                width: 198,
                height: 308,
                hasAlpha: false,
                createdAt: CREATED_AT,
              },
            ],
          },
        ],
      });

    const mounted = renderDesignCanvas(undefined, {
      analyzeFlatImage,
    });
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
    });
    await waitForCanvasState(
      () => mounted.readState().document.title === "teaser-poster",
      "上传扁平图后 DesignCanvas 状态未切换到 extraction draft。",
    );

    expect(analyzeFlatImage).toHaveBeenCalledWith({
      image: expect.objectContaining({
        src: "data:image/png;base64,ZmxhdC1pbWFnZQ==",
        width: 900,
        height: 1400,
        mimeType: "image/png",
      }),
      createdAt: expect.any(String),
    });
    expect(mounted.readState().document.title).toBe("teaser-poster");
    expect(mounted.readState().document.layers.map((layer) => layer.id)).toEqual(
      ["extraction-background-image", "subject-layer", "headline-layer"],
    );
    expect(mounted.readState().selectedLayerId).toBe("headline-layer");
    expect(mounted.readState().document.extraction).toMatchObject({
      sourceAssetId: "teaser-poster-source-image",
      review: {
        status: "pending",
      },
      analysis: {
        analyzer: {
          kind: "local_heuristic",
          label: "本地 heuristic analyzer",
        },
        outputs: {
          candidateRaster: true,
          candidateMask: false,
          cleanPlate: false,
          ocrText: false,
        },
      },
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
    expect(document.body.textContent).toContain("本地 heuristic analyzer");
    expect(document.body.textContent).toContain("进入图层编辑");
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

    expect(document.body.textContent).toContain("候选图层");
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

  it("拆层确认态应在进入图层编辑后标记 confirmed，并退出确认面板", () => {
    const mounted = renderDesignCanvas(
      {
        type: "design",
        document: createFlatImageDraftDocumentWithCleanPlate(),
        selectedLayerId: "subject-layer",
        zoom: 0.72,
      },
      {},
    );

    expect(document.body.textContent).toContain("确认候选图层后进入编辑");
    expect(mounted.readState().document.extraction?.review.status).toBe(
      "pending",
    );

    clickButton("进入图层编辑");

    expect(mounted.readState().document.extraction?.review.status).toBe(
      "confirmed",
    );
    expect(mounted.readState().document.editHistory.at(-1)?.type).toBe(
      "candidate_selection_confirmed",
    );
    expect(document.body.textContent).not.toContain("仅保留原图");
  });

  it("高风险拆层应阻止直接进入编辑，并保留安全出口", () => {
    const mounted = renderDesignCanvas(
      {
        type: "design",
        document: createFlatImageDraftDocument(),
        selectedLayerId: "subject-layer",
        zoom: 0.72,
      },
      {},
    );

    const enterButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("进入图层编辑"),
    ) as HTMLButtonElement | undefined;
    const sourceOnlyButton = Array.from(
      document.querySelectorAll("button"),
    ).find((button) =>
      button.textContent?.includes("仅保留原图"),
    ) as HTMLButtonElement | undefined;

    expect(document.body.textContent).toContain("拆层质量：高风险");
    expect(document.body.textContent).toContain(
      "高风险拆层已阻止直接进入编辑",
    );
    expect(enterButton?.disabled).toBe(true);
    expect(enterButton?.title).toContain("当前拆层质量为高风险");
    expect(sourceOnlyButton?.disabled).toBe(false);

    clickButton("进入图层编辑");

    expect(mounted.readState().document.extraction?.review.status).toBe(
      "pending",
    );
    expect(mounted.readState().document.editHistory.at(-1)?.type).not.toBe(
      "candidate_selection_confirmed",
    );
  });

  it("拆层确认态应提示 clean plate 失败时移动主体有露洞风险", () => {
    renderDesignCanvas(
      {
        type: "design",
        document: createFlatImageDraftDocument(),
        selectedLayerId: "subject-layer",
        zoom: 0.72,
      },
      {},
    );

    expect(document.body.textContent).toContain(
      "背景修补失败，移动主体有露洞风险",
    );
    expect(document.body.textContent).toContain("拆层质量：高风险");
    expect(document.body.textContent).toContain("主体 mask 缺失");
    expect(document.body.textContent).toContain("clean plate 失败");
    expect(document.body.textContent).toContain("OCR TextLayer 未提供");
    expect(document.body.textContent).toContain("修补失败，保留原图背景。");
    expect(document.body.textContent).toContain("背景修补来源");
    expect(document.body.textContent).toContain("未记录");
  });

  it("拆层确认态应支持原图、当前候选和 clean plate 对照预览", () => {
    renderDesignCanvas(
      {
        type: "design",
        document: createFlatImageDraftDocumentWithCleanPlate(),
        selectedLayerId: "subject-layer",
        zoom: 0.72,
      },
      {},
    );

    const sourcePreview = document.querySelector(
      'img[alt="拆层确认预览：原图"]',
    ) as HTMLImageElement | null;
    expect(sourcePreview?.src).toContain("data:image/png;base64,ZmxhdC1jbGVhbg==");

    clickButton("查看当前候选");

    const candidatePreview = document.querySelector(
      'img[alt="拆层确认预览：人物主体"]',
    ) as HTMLImageElement | null;
    expect(candidatePreview?.src).toContain(
      "data:image/png;base64,c3ViamVjdC1jbGVhbg==",
    );

    clickButton("查看修补背景");

    const cleanPlatePreview = document.querySelector(
      'img[alt="拆层确认预览：修补背景"]',
    ) as HTMLImageElement | null;
    expect(cleanPlatePreview?.src).toContain(
      "data:image/png;base64,Y2xlYW4tcGxhdGU=",
    );
    expect(document.body.textContent).toContain("背景修补可用。");
    expect(document.body.textContent).toContain("拆层质量：需要人工复核");
    expect(document.body.textContent).toContain("能力来源需人工复核");
    expect(document.body.textContent).toContain("背景修补可用于进入编辑");
    expect(document.body.textContent).toContain(
      "背景修补来源：测试 clean plate provider / fixture-inpaint",
    );
    expect(document.body.textContent).toContain("能力矩阵");
    expect(document.body.textContent).toContain("1 项 / 1 项需人工复核");
    expect(document.body.textContent).toContain(
      "Simple browser clean plate provider",
    );
    expect(document.body.textContent).toContain("实验/占位，需人工复核");
    expect(document.body.textContent).toContain("移动主体后仍建议核对边缘");
    expect(document.body.textContent).toContain("测试 clean plate analyzer");
    expect(document.body.textContent).toContain("mask");
    expect(document.body.textContent).toContain("未提供");
    expect(document.body.textContent).toContain("模型执行");
    expect(document.body.textContent).toContain("2 条 / 均直接成功");
    expect(document.body.textContent).toContain(
      "主体抠图：runtime-matting-v1 / attempt 1/1 / succeeded",
    );
    expect(document.body.textContent).toContain(
      "背景修补：runtime-inpaint-v1 / attempt 2/2 / succeeded",
    );
    expect(document.body.textContent).toContain("来源：人物主体");
    expect(document.body.textContent).toContain("来源：clean plate");
  });

  it("拆层确认态应支持查看当前候选的 mask 预览", () => {
    renderDesignCanvas(
      {
        type: "design",
        document: createFlatImageDraftDocumentWithMaskAndTextCandidate(),
        selectedLayerId: "subject-layer",
        zoom: 0.72,
      },
      {},
    );

    clickButton("查看 mask");

    const maskPreview = document.querySelector(
      'img[alt="拆层确认预览：人物主体 mask"]',
    ) as HTMLImageElement | null;
    expect(maskPreview?.src).toContain("data:image/png;base64,bWFzay1vY3I=");
    expect(document.body.textContent).toContain("裁切范围");
  });

  it("拆层确认态应对 OCR TextLayer 候选使用真实图层预览", () => {
    renderDesignCanvas(
      {
        type: "design",
        document: createFlatImageDraftDocumentWithMaskAndTextCandidate(),
        selectedLayerId: "headline-layer",
        zoom: 0.72,
      },
      {},
    );

    clickButton("查看当前候选");

    const textPreview = document.querySelector(
      '[aria-label="拆层确认预览：标题文案"]',
    );
    expect(textPreview?.textContent).toContain("霓虹开幕");
    expect(document.body.textContent).toContain("图片候选显示裁片，文字候选直接渲染 TextLayer");
    expect(document.body.textContent).toContain("模型执行");
    expect(document.body.textContent).toContain("1 条 / 1 条 fallback");
    expect(document.body.textContent).toContain(
      "OCR TextLayer：runtime-ocr-v1 / attempt 1/1 / fallback_succeeded",
    );
    expect(document.body.textContent).toContain("来源：标题文案 / 已走 fallback");
  });

  it("仅保留原图进入图层编辑时应清空候选层并保留背景层", () => {
    const mounted = renderDesignCanvas(
      {
        type: "design",
        document: createFlatImageDraftDocument(),
        selectedLayerId: "subject-layer",
        zoom: 0.72,
      },
      {},
    );

    clickButton("仅保留原图");

    expect(mounted.readState().document.extraction?.review.status).toBe(
      "confirmed",
    );
    expect(
      mounted.readState().document.extraction?.candidates.every(
        (candidate) => !candidate.selected,
      ),
    ).toBe(true);
    expect(mounted.readState().document.layers.map((layer) => layer.id)).toEqual(
      ["extraction-background-image"],
    );
    expect(mounted.readState().selectedLayerId).toBe(
      "extraction-background-image",
    );
    expect(mounted.readState().document.editHistory.at(-1)?.type).toBe(
      "candidate_selection_confirmed",
    );
  });

  it("重新拆层应通过 current analyzer seam 刷新候选层，并保持待确认状态", async () => {
    const analyzeFlatImage: AnalyzeLayeredDesignFlatImage = vi
      .fn()
      .mockResolvedValue({
        analysis: {
          analyzer: {
            kind: "local_heuristic",
            label: "测试 analyzer",
          },
          outputs: {
            candidateRaster: true,
            candidateMask: true,
            cleanPlate: false,
            ocrText: false,
          },
          generatedAt: CREATED_AT,
        },
        cleanPlate: {
          status: "not_requested",
          message: "重新拆层尚未生成 clean plate。",
        },
        candidates: [
          {
            id: "logo-candidate",
            role: "logo",
            confidence: 0.82,
            layer: {
              id: "logo-layer",
              name: "新 Logo",
              type: "image",
              assetId: "logo-asset-v2",
              x: 88,
              y: 96,
              width: 320,
              height: 160,
              zIndex: 36,
              alphaMode: "embedded",
            },
            assets: [
              {
                id: "logo-asset-v2",
                kind: "logo",
                src: "data:image/png;base64,bG9nby12Mg==",
                width: 320,
                height: 160,
                hasAlpha: true,
                createdAt: CREATED_AT,
              },
            ],
          },
        ],
      });

    const mounted = renderDesignCanvas(
      {
        type: "design",
        document: createFlatImageDraftDocument(),
        selectedLayerId: "subject-layer",
        zoom: 0.72,
      },
      {
        analyzeFlatImage,
      },
    );

    await clickButtonAsync("重新拆层");

    expect(analyzeFlatImage).toHaveBeenCalledWith({
      image: expect.objectContaining({
        src: "data:image/png;base64,ZmxhdA==",
        width: 1080,
        height: 1440,
        mimeType: "image/png",
        hasAlpha: false,
      }),
      createdAt: expect.any(String),
    });
    expect(mounted.readState().document.extraction?.review.status).toBe(
      "pending",
    );
    expect(mounted.readState().document.extraction?.analysis).toMatchObject({
      analyzer: {
        label: "测试 analyzer",
      },
      outputs: {
        candidateMask: true,
      },
    });
    expect(mounted.readState().document.extraction?.candidates).toHaveLength(1);
    expect(mounted.readState().document.layers.map((layer) => layer.id)).toEqual(
      ["extraction-background-image", "logo-layer"],
    );
    expect(mounted.readState().document.editHistory.at(-1)?.type).toBe(
      "extraction_reanalyzed",
    );
    expect(document.body.textContent).toContain("测试 analyzer");
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
          analyzerModelSlotConfigs: [
            {
              id: "test-clean-slot",
              kind: "clean_plate",
              label: "Test clean slot",
              modelId: "test-clean-v1",
              metadata: {
                productionReady: true,
                requiresHumanReview: false,
              },
            },
          ],
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
              relativePath: "trial.psd",
              encoding: "base64",
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
      const manifestFile = saveProjectExport.mock.calls[0][0].files.find(
        (file: { relativePath?: string }) =>
          file.relativePath === "export-manifest.json",
      );
      expect(JSON.parse(manifestFile?.content ?? "{}")).toMatchObject({
        analyzerModelSlots: [
          {
            config: {
              id: "test-clean-slot",
              kind: "clean_plate",
              modelId: "test-clean-v1",
            },
            readiness: {
              valid: true,
              productionGate: {
                readyForProduction: true,
              },
            },
          },
        ],
      });
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

  it("画布内拖拽图层应按画布比例回写 transform", () => {
    const mounted = renderDesignCanvas();
    const stage = document.querySelector(
      '[aria-label="设计画布预览"]',
    ) as HTMLElement | null;
    const layerButton = document.querySelector(
      'button[aria-label="选择图层 标题层"]',
    ) as HTMLButtonElement | null;

    expect(stage).not.toBeNull();
    expect(layerButton).not.toBeNull();
    if (!stage || !layerButton) {
      throw new Error("未找到画布或标题层按钮");
    }
    Object.defineProperty(stage, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 540,
        bottom: 720,
        width: 540,
        height: 720,
        toJSON: () => ({}),
      }),
    });

    dispatchPointerEvent(layerButton, "pointerdown", {
      clientX: 100,
      clientY: 100,
    });
    dispatchPointerEvent(layerButton, "pointermove", {
      clientX: 120,
      clientY: 130,
    });
    dispatchPointerEvent(layerButton, "pointerup", {
      clientX: 120,
      clientY: 130,
    });

    const updatedLayer = mounted
      .readState()
      .document.layers.find((layer) => layer.id === "headline");
    expect(updatedLayer).toMatchObject({
      x: 200,
      y: 180,
    });
    expect(mounted.readState().document.preview?.stale).toBe(true);
    expect(mounted.readState().document.editHistory.at(-1)).toMatchObject({
      type: "transform_updated",
      layerId: "headline",
      summary: "画布内拖拽移动图层。",
    });
  });

  it("画布角点缩放手柄应按画布比例回写尺寸", () => {
    const mounted = renderDesignCanvas();
    const stage = document.querySelector(
      '[aria-label="设计画布预览"]',
    ) as HTMLElement | null;
    const resizeHandle = document.querySelector(
      '[aria-label="缩放图层 标题层 se"]',
    ) as HTMLElement | null;

    expect(stage).not.toBeNull();
    expect(resizeHandle).not.toBeNull();
    if (!stage || !resizeHandle) {
      throw new Error("未找到画布或缩放手柄");
    }
    Object.defineProperty(stage, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 540,
        bottom: 720,
        width: 540,
        height: 720,
        toJSON: () => ({}),
      }),
    });

    dispatchPointerEvent(resizeHandle, "pointerdown", {
      clientX: 100,
      clientY: 100,
    });
    dispatchPointerEvent(resizeHandle, "pointermove", {
      clientX: 130,
      clientY: 120,
    });
    dispatchPointerEvent(resizeHandle, "pointerup", {
      clientX: 130,
      clientY: 120,
    });

    const updatedLayer = mounted
      .readState()
      .document.layers.find((layer) => layer.id === "headline");
    expect(updatedLayer).toMatchObject({
      x: 160,
      y: 120,
      width: 820,
      height: 180,
    });
    expect(mounted.readState().document.preview?.stale).toBe(true);
    expect(mounted.readState().document.editHistory.at(-1)).toMatchObject({
      type: "transform_updated",
      layerId: "headline",
      summary: "画布内缩放图层。",
    });
  });

  it("画布旋转手柄应围绕图层中心回写 rotation", () => {
    const mounted = renderDesignCanvas();
    const stage = document.querySelector(
      '[aria-label="设计画布预览"]',
    ) as HTMLElement | null;
    const rotateHandle = document.querySelector(
      '[aria-label="旋转图层 标题层"]',
    ) as HTMLElement | null;

    expect(stage).not.toBeNull();
    expect(rotateHandle).not.toBeNull();
    if (!stage || !rotateHandle) {
      throw new Error("未找到画布或旋转手柄");
    }
    Object.defineProperty(stage, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 540,
        bottom: 720,
        width: 540,
        height: 720,
        toJSON: () => ({}),
      }),
    });

    dispatchPointerEvent(rotateHandle, "pointerdown", {
      clientX: 270,
      clientY: 30,
    });
    dispatchPointerEvent(rotateHandle, "pointermove", {
      clientX: 335,
      clientY: 95,
    });
    dispatchPointerEvent(rotateHandle, "pointerup", {
      clientX: 335,
      clientY: 95,
    });

    const updatedLayer = mounted
      .readState()
      .document.layers.find((layer) => layer.id === "headline");
    expect(updatedLayer).toMatchObject({
      rotation: 90,
    });
    expect(mounted.readState().document.preview?.stale).toBe(true);
    expect(mounted.readState().document.editHistory.at(-1)).toMatchObject({
      type: "transform_updated",
      layerId: "headline",
      summary: "画布内旋转图层。",
    });
  });

  it("编辑位置尺寸旋转透明度层级应回写 LayeredDesignDocument transform", () => {
    const mounted = renderDesignCanvas();

    changeInputValue("图层 X", "188");
    changeInputValue("图层 Y", "144");
    changeInputValue("图层宽度", "820");
    changeInputValue("图层高度", "180");
    changeInputValue("图层旋转", "-12");
    changeInputValue("图层透明度", "55");
    changeInputValue("图层层级", "12");

    const updatedLayer = mounted
      .readState()
      .document.layers.find((layer) => layer.id === "headline");
    expect(updatedLayer).toMatchObject({
      x: 188,
      y: 144,
      width: 820,
      height: 180,
      rotation: -12,
      opacity: 0.55,
      zIndex: 12,
    });
    expect(mounted.readState().document.preview?.stale).toBe(true);
    expect(mounted.readState().document.editHistory.at(-1)).toMatchObject({
      type: "transform_updated",
      layerId: "headline",
      transformAfter: expect.objectContaining({
        zIndex: 12,
      }),
    });
  });

  it("编辑 TextLayer 文案应回写文档而不是烘焙成图片层", () => {
    const mounted = renderDesignCanvas();
    const textArea = document.querySelector(
      'textarea[aria-label="文字内容"]',
    ) as HTMLTextAreaElement | null;

    expect(textArea).not.toBeNull();
    if (!textArea) {
      throw new Error("未找到 TextLayer 文字内容输入框");
    }
    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(textArea, "可编辑的新标题");
      textArea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const updatedLayer = mounted
      .readState()
      .document.layers.find((layer) => layer.id === "headline");
    expect(updatedLayer).toMatchObject({
      type: "text",
      text: "可编辑的新标题",
    });
    expect(mounted.readState().document.preview?.stale).toBe(true);
    expect(mounted.readState().document.editHistory.at(-1)).toMatchObject({
      type: "text_updated",
      layerId: "headline",
      previousText: "冥界女巫",
      nextText: "可编辑的新标题",
    });
    expect(document.body.textContent).toContain("可编辑的新标题");
    expect(
      mounted
        .readState()
        .document.layers.find((layer) => layer.id === "subject"),
    ).toMatchObject({
      type: "image",
      assetId: "asset-subject",
    });
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
