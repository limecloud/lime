import { describe, expect, it } from "vitest";
import {
  buildLayeredDesignProviderCapabilitySummary,
  chooseLayeredDesignProviderCapability,
  createLayeredDesignProviderCapabilityRegistry,
  createLayeredDesignAnalyzerProviderCapabilityGateRequirements,
  evaluateLayeredDesignAnalyzerProviderCapabilityGate,
  findLayeredDesignProviderCapabilities,
  getLayeredDesignProviderCapabilityWarnings,
} from "./providerCapabilities";

describe("layered-design analyzer provider capabilities", () => {
  it("应按 subject matting / clean plate / OCR 三类查询内置能力", () => {
    const registry = createLayeredDesignProviderCapabilityRegistry();

    expect(
      findLayeredDesignProviderCapabilities(registry, "subject_matting").map(
        (capability) => capability.label,
      ),
    ).toContain("Simple browser subject matting provider");
    expect(
      findLayeredDesignProviderCapabilities(registry, "clean_plate").map(
        (capability) => capability.label,
      ),
    ).toContain("Simple browser clean plate provider");
    expect(
      findLayeredDesignProviderCapabilities(registry, "text_ocr").map(
        (capability) => capability.label,
      ),
    ).toContain("Tauri native OCR provider");
  });

  it("应为 clean plate 选择支持 PNG data URL、mask 输入和 clean plate 输出的 Worker provider", () => {
    const registry = createLayeredDesignProviderCapabilityRegistry();

    expect(
      chooseLayeredDesignProviderCapability(registry, "clean_plate", {
        execution: "browser_worker",
        supports: {
          dataUrlPng: true,
          maskInput: true,
          cleanPlateOutput: true,
        },
      }),
    ).toMatchObject({
      label: "Simple browser clean plate provider",
      modelId: "simple_neighbor_inpaint_v1",
      quality: {
        productionReady: false,
        requiresHumanReview: true,
      },
    });
  });

  it("生产可用要求不应命中当前 simple / deterministic 占位能力", () => {
    const registry = createLayeredDesignProviderCapabilityRegistry();

    expect(
      chooseLayeredDesignProviderCapability(registry, "clean_plate", {
        supports: { cleanPlateOutput: true },
        quality: { productionReady: true },
      }),
    ).toBeNull();
    expect(
      chooseLayeredDesignProviderCapability(registry, "subject_matting", {
        supports: { alphaOutput: true },
        quality: { productionReady: true },
      }),
    ).toBeNull();
  });

  it("OCR 文字几何要求可命中 Worker 与 native command 能力", () => {
    const registry = createLayeredDesignProviderCapabilityRegistry();

    expect(
      chooseLayeredDesignProviderCapability(registry, "text_ocr", {
        supports: { textGeometry: true },
      }),
    ).toMatchObject({
      label: "Worker OCR deterministic provider",
    });
    expect(
      chooseLayeredDesignProviderCapability(registry, "text_ocr", {
        execution: "native_command",
        supports: { textGeometry: true },
      }),
    ).toMatchObject({
      label: "Tauri native OCR provider",
    });
  });

  it("应返回不满足能力要求的可读 warning", () => {
    const registry = createLayeredDesignProviderCapabilityRegistry();
    const capability = chooseLayeredDesignProviderCapability(
      registry,
      "clean_plate",
      { execution: "browser_worker" },
    );

    expect(capability).not.toBeNull();
    expect(
      getLayeredDesignProviderCapabilityWarnings(capability!, {
        supports: { textGeometry: true },
        quality: { productionReady: true },
      }),
    ).toEqual([
      "文字几何信息 需要 是，实际为 未知",
      "生产可用 需要 是，实际为 否",
    ]);
  });

  it("summary 应说明 simple clean plate 是实验能力，不宣称真模型 inpaint", () => {
    const registry = createLayeredDesignProviderCapabilityRegistry();
    const capability = chooseLayeredDesignProviderCapability(
      registry,
      "clean_plate",
      {
        execution: "browser_worker",
        supports: { cleanPlateOutput: true },
      },
    );

    expect(capability).not.toBeNull();
    const summary = buildLayeredDesignProviderCapabilitySummary(capability!);

    expect(summary).toContain("Simple browser clean plate provider");
    expect(summary).toContain("simple_neighbor_inpaint_v1");
    expect(summary).toContain("实验/占位，需人工复核");
    expect(summary).not.toContain("真模型 inpaint");
  });

  it("capability gate 应把 simple clean plate 标记为未满足生产准入", () => {
    const registry = createLayeredDesignProviderCapabilityRegistry();
    const simpleCleanPlate = chooseLayeredDesignProviderCapability(
      registry,
      "clean_plate",
      {
        execution: "browser_worker",
        supports: { cleanPlateOutput: true },
      },
    );
    const requirements =
      createLayeredDesignAnalyzerProviderCapabilityGateRequirements({
        requireCleanPlate: true,
      });

    expect(simpleCleanPlate).not.toBeNull();
    expect(
      evaluateLayeredDesignAnalyzerProviderCapabilityGate(
        simpleCleanPlate ? [simpleCleanPlate] : [],
        requirements,
      ),
    ).toEqual({
      readyForProduction: false,
      checks: [
        {
          requirementId: "clean_plate_masked_output",
          label: "clean plate 需要支持 mask 输入和背景修补输出",
          kind: "clean_plate",
          status: "failed",
          capabilityLabel: "Simple browser clean plate provider",
          capabilityModelId: "simple_neighbor_inpaint_v1",
          warnings: ["生产可用 需要 是，实际为 否"],
        },
      ],
    });
  });
});
