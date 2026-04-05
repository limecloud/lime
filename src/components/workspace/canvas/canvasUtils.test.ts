/**
 * @file 画布工具函数测试
 * @description 验证统一 general 工作台默认使用文档画布
 * @module components/workspace/canvas/canvasUtils.test
 */

import { describe, expect, it } from "vitest";
import {
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
