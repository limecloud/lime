import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  deleteBrandExtension,
  getBrandExtension,
  getBrandPersona,
  listBrandPersonaTemplates,
  saveBrandExtension,
  updateBrandExtension,
} from "./brandPersona";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("brandPersona API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应获取品牌人设与扩展", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ id: "persona-1", name: "品牌人设" })
      .mockResolvedValueOnce({ personaId: "persona-1", brandTone: "专业" });

    await expect(getBrandPersona("persona-1")).resolves.toEqual(
      expect.objectContaining({ id: "persona-1" }),
    );
    await expect(getBrandExtension("persona-1")).resolves.toEqual(
      expect.objectContaining({ personaId: "persona-1" }),
    );
  });

  it("应代理品牌扩展写操作与模板列表", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ personaId: "persona-2" })
      .mockResolvedValueOnce({ personaId: "persona-2" })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ id: "tpl-1", name: "专业风" }]);

    const design = {
      primaryStyle: "modern" as const,
      colorScheme: {
        primary: "#111111",
        secondary: "#222222",
        accent: "#333333",
        background: "#ffffff",
        text: "#111111",
        textSecondary: "#666666",
      },
      typography: {
        titleFont: "思源黑体",
        titleWeight: 700,
        bodyFont: "苹方",
        bodyWeight: 400,
        titleSize: 48,
        bodySize: 16,
        lineHeight: 1.5,
        letterSpacing: 0,
      },
    };
    const visual = {
      logoPlacement: {
        defaultPosition: "top-left" as const,
        padding: 16,
        maxSize: 20,
      },
      imageStyle: {
        borderRadius: 8,
        preferredRatio: "16:9",
      },
      iconStyle: {
        style: "outlined" as const,
        defaultColor: "#111111",
      },
      decorations: [],
    };

    await expect(
      saveBrandExtension({
        personaId: "persona-2",
        brandTone: {
          keywords: ["专业"],
          personality: "professional",
        },
        design,
        visual,
      }),
    ).resolves.toEqual(expect.objectContaining({ personaId: "persona-2" }));
    await expect(
      updateBrandExtension("persona-2", {
        brandTone: {
          keywords: ["亲和"],
          personality: "friendly",
        },
      }),
    ).resolves.toEqual(expect.objectContaining({ personaId: "persona-2" }));
    await expect(deleteBrandExtension("persona-2")).resolves.toBeUndefined();
    await expect(listBrandPersonaTemplates()).resolves.toEqual([
      expect.objectContaining({ id: "tpl-1" }),
    ]);
  });
});
