import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupMountedRoots,
  renderIntoDom,
  setReactActEnvironment,
  type MountedRoot,
} from "@/components/image-gen/test-utils";

const { mockUseGalleryMaterial, mockConvertLocalFileSrc } = vi.hoisted(() => ({
  mockUseGalleryMaterial: vi.fn(),
  mockConvertLocalFileSrc: vi.fn(),
}));

vi.mock("@/hooks/useGalleryMaterial", () => ({
  useGalleryMaterial: mockUseGalleryMaterial,
}));

vi.mock("@/lib/api/fileSystem", () => ({
  convertLocalFileSrc: mockConvertLocalFileSrc,
}));

import { ImageGallery } from "./ImageGallery";

const mountedRoots: MountedRoot[] = [];

function renderGallery() {
  return renderIntoDom(<ImageGallery projectId="project-1" />, mountedRoots)
    .container;
}

describe("ImageGallery", () => {
  beforeEach(() => {
    setReactActEnvironment();
    vi.clearAllMocks();
    mockConvertLocalFileSrc.mockReturnValue("asset://preview.png");
    mockUseGalleryMaterial.mockReturnValue({
      materials: [
        {
          id: "image-1",
          type: "image",
          projectId: "project-1",
          name: "预览图",
          filePath: "/tmp/preview.png",
          tags: [],
          createdAt: 1,
        },
      ],
      loading: false,
      filter: { type: "image" },
      setFilter: vi.fn(),
    });
  });

  afterEach(() => {
    cleanupMountedRoots(mountedRoots);
  });

  it("本地图片预览应走统一文件 URL 转换", () => {
    const container = renderGallery();
    const image = container.querySelector("img");

    expect(image).toBeInstanceOf(HTMLImageElement);
    expect(mockConvertLocalFileSrc).toHaveBeenCalledWith("/tmp/preview.png");
    expect(image?.getAttribute("src")).toBe("asset://preview.png");
  });
});
