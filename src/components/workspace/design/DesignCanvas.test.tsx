import React, { useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaTaskArtifactOutput } from "@/lib/api/mediaTasks";
import {
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

  it("应暴露 design.json、assets manifest 与 PNG 的设计工程导出入口", () => {
    renderDesignCanvas();

    expect(document.body.textContent).toContain("导出设计工程");
    expect(document.body.textContent).not.toContain("PNG 导出待接入");
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
