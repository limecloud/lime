import { describe, expect, it } from "vitest";
import {
  createLayeredDesignAnalyzerModelSlotMetadata,
  createLayeredDesignAnalyzerProviderCapabilityFromModelSlotConfig,
  evaluateLayeredDesignAnalyzerModelSlotConfigReadiness,
  normalizeLayeredDesignAnalyzerModelSlotConfig,
  validateLayeredDesignAnalyzerModelSlotConfig,
} from "./analyzerModelSlotConfig";

describe("layered-design analyzer model slot config", () => {
  it("应归一化 clean plate slot config 并导出 capability / metadata", () => {
    const config = normalizeLayeredDesignAnalyzerModelSlotConfig({
      id: " clean-plate-prod ",
      kind: "clean_plate",
      label: " Production clean plate ",
      modelId: " inpaint-pro-v1 ",
      io: {
        dataUrlPng: true,
      },
      runtime: {
        timeoutMs: 60_000,
        maxAttempts: 2,
        fallbackStrategy: "use_heuristic",
      },
      metadata: {
        providerId: "remote-lab",
        modelVersion: "2026-05-07",
        productionReady: true,
        requiresHumanReview: false,
        tags: ["inpaint", " clean-plate ", "inpaint"],
      },
    });

    expect(config).toMatchObject({
      id: "clean-plate-prod",
      kind: "clean_plate",
      label: "Production clean plate",
      execution: "remote_model",
      modelId: "inpaint-pro-v1",
      io: {
        dataUrlPng: true,
        maskInput: true,
        cleanPlateOutput: true,
      },
      runtime: {
        timeoutMs: 60_000,
        maxAttempts: 2,
        fallbackStrategy: "use_heuristic",
      },
      metadata: {
        providerId: "remote-lab",
        modelVersion: "2026-05-07",
        productionReady: true,
        requiresHumanReview: false,
        tags: ["inpaint", "clean-plate"],
      },
    });
    expect(
      createLayeredDesignAnalyzerProviderCapabilityFromModelSlotConfig(config),
    ).toMatchObject({
      kind: "clean_plate",
      label: "Production clean plate",
      modelId: "inpaint-pro-v1",
      supports: {
        dataUrlPng: true,
        maskInput: true,
        cleanPlateOutput: true,
      },
      quality: {
        productionReady: true,
        requiresHumanReview: false,
      },
    });
    expect(createLayeredDesignAnalyzerModelSlotMetadata(config)).toMatchObject({
      slotId: "clean-plate-prod",
      slotKind: "clean_plate",
      providerLabel: "Production clean plate",
      modelId: "inpaint-pro-v1",
      fallbackStrategy: "use_heuristic",
      tags: ["inpaint", "clean-plate"],
    });
  });

  it("应给 subject matting / OCR 自动填充最小 IO 默认值", () => {
    expect(
      normalizeLayeredDesignAnalyzerModelSlotConfig({
        id: "matting",
        kind: "subject_matting",
        label: "Subject Matting",
        modelId: "matting-v1",
      }).io,
    ).toMatchObject({
      dataUrlPng: true,
      alphaOutput: true,
      maskOutput: true,
      cleanPlateOutput: false,
    });

    expect(
      normalizeLayeredDesignAnalyzerModelSlotConfig({
        id: "ocr",
        kind: "text_ocr",
        label: "OCR",
        modelId: "ocr-v1",
      }).io,
    ).toMatchObject({
      dataUrlPng: true,
      textGeometry: true,
      alphaOutput: false,
    });
  });

  it("应校验缺失字段和违反 kind IO contract 的配置", () => {
    const config = normalizeLayeredDesignAnalyzerModelSlotConfig({
      id: " ",
      kind: "clean_plate",
      label: "",
      modelId: "",
      io: {
        dataUrlPng: false,
        maskInput: false,
        cleanPlateOutput: false,
      },
      runtime: {
        timeoutMs: -1,
      },
    });

    expect(validateLayeredDesignAnalyzerModelSlotConfig(config)).toEqual([
      "model slot id 不能为空",
      "model slot label 不能为空",
      "model slot modelId 不能为空",
      "model slot 必须支持 PNG data URL 输入/输出",
      "clean plate slot 必须支持 mask 输入",
      "clean plate slot 必须输出 clean plate",
    ]);
  });

  it("readiness 应合并 schema warning 与 production gate warning", () => {
    expect(
      evaluateLayeredDesignAnalyzerModelSlotConfigReadiness({
        id: "clean",
        kind: "clean_plate",
        label: "Simple clean plate",
        modelId: "simple-clean",
        io: {
          dataUrlPng: true,
          maskInput: true,
          cleanPlateOutput: true,
        },
        metadata: {
          productionReady: false,
        },
      }),
    ).toMatchObject({
      valid: false,
      warnings: ["生产可用 需要 是，实际为 否"],
      productionGate: {
        readyForProduction: false,
        checks: [
          {
            status: "failed",
            capabilityLabel: "Simple clean plate",
          },
        ],
      },
    });
  });

  it("生产级配置应通过 readiness", () => {
    expect(
      evaluateLayeredDesignAnalyzerModelSlotConfigReadiness({
        id: "ocr-prod",
        kind: "text_ocr",
        label: "Production OCR",
        modelId: "ocr-prod-v1",
        metadata: {
          productionReady: true,
          requiresHumanReview: false,
        },
      }),
    ).toMatchObject({
      valid: true,
      warnings: [],
      productionGate: {
        readyForProduction: true,
      },
    });
  });
});
