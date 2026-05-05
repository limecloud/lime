/**
 * @file 画布工具函数测试
 * @description 验证统一 general 工作台默认使用文档画布
 * @module components/workspace/canvas/canvasUtils.test
 */

import { describe, expect, it } from "vitest";
import {
  createInitialDesignCanvasState,
  createInitialCanvasState,
  getCanvasTypeForTheme,
  isCanvasSupported,
} from "./canvasUtils";

describe("getCanvasTypeForTheme", () => {
  it("general 主题应统一映射到 document 画布", () => {
    expect(getCanvasTypeForTheme("general")).toBe("document");
  });
});

describe("isCanvasSupported", () => {
  it("general 主题应继续支持画布", () => {
    expect(isCanvasSupported("general")).toBe(true);
  });
});

describe("createInitialCanvasState", () => {
  it("general 主题应创建文档画布状态", () => {
    const state = createInitialCanvasState("general", "test content");
    expect(state).not.toBeNull();
    expect(state?.type).toBe("document");
  });

  it("空内容时也应返回可用的文档画布状态", () => {
    const state = createInitialCanvasState("general");
    expect(state).not.toBeNull();
    expect(state?.type).toBe("document");
  });
});

describe("createInitialDesignCanvasState", () => {
  it("应创建 AI 图层化设计画布状态", () => {
    const state = createInitialDesignCanvasState({
      id: "design-canvas-state",
      title: "图层设计",
      canvas: { width: 1080, height: 1440 },
      layers: [],
      assets: [],
      createdAt: "2026-05-05T00:00:00.000Z",
    });

    expect(state.type).toBe("design");
    expect(state.document.id).toBe("design-canvas-state");
    expect(state.document.title).toBe("图层设计");
  });
});
