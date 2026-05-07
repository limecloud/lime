import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import {
  analyzeLayeredDesignFlatImageNative,
  recognizeLayeredDesignText,
} from "./layeredDesignAnalysis";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("layeredDesignAnalysis API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应通过 current Tauri 命令代理图层设计 OCR", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce({
      supported: true,
      engine: "mock-native-ocr",
      blocks: [
        {
          text: "霓虹开幕",
          boundingBox: {
            x: 12,
            y: 16,
            width: 320,
            height: 72,
          },
          confidence: 0.9,
        },
      ],
    });

    await expect(
      recognizeLayeredDesignText({
        imageSrc: "data:image/png;base64,ZmFrZQ==",
        width: 640,
        height: 180,
        candidateId: "headline-candidate",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        supported: true,
        engine: "mock-native-ocr",
        blocks: [expect.objectContaining({ text: "霓虹开幕" })],
      }),
    );

    expect(safeInvoke).toHaveBeenCalledWith("recognize_layered_design_text", {
      request: {
        imageSrc: "data:image/png;base64,ZmFrZQ==",
        width: 640,
        height: 180,
        candidateId: "headline-candidate",
      },
    });
  });

  it("应通过 current Tauri 命令代理扁平图 structured analyzer", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce({
      supported: true,
      engine: "native_heuristic_analyzer",
      result: {
        analyzer: {
          kind: "local_heuristic",
          label: "Tauri native heuristic analyzer",
        },
        generatedAt: "2026-05-07T00:00:00.000Z",
        candidates: [],
        cleanPlate: {
          status: "not_requested",
        },
      },
    });

    await expect(
      analyzeLayeredDesignFlatImageNative({
        image: {
          src: "data:image/png;base64,ZmFrZQ==",
          width: 900,
          height: 1400,
          mimeType: "image/png",
        },
        createdAt: "2026-05-07T00:00:00.000Z",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        supported: true,
        engine: "native_heuristic_analyzer",
        result: expect.objectContaining({
          analyzer: expect.objectContaining({
            label: "Tauri native heuristic analyzer",
          }),
        }),
      }),
    );

    expect(safeInvoke).toHaveBeenCalledWith(
      "analyze_layered_design_flat_image",
      {
        request: {
          image: {
            src: "data:image/png;base64,ZmFrZQ==",
            width: 900,
            height: 1400,
            mimeType: "image/png",
          },
          createdAt: "2026-05-07T00:00:00.000Z",
        },
      },
    );
  });
});
