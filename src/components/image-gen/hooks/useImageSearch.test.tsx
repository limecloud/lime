import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupMountedRoots,
  flushEffects,
  renderIntoDom,
  setReactActEnvironment,
  waitForCondition,
  type MountedRoot,
} from "../test-utils";
import { useImageSearch } from "./useImageSearch";

const { mockSearchPixabayImages, mockSearchWebImages } = vi.hoisted(() => ({
  mockSearchPixabayImages: vi.fn(),
  mockSearchWebImages: vi.fn(),
}));

vi.mock("@/lib/api/imageSearch", () => ({
  searchPixabayImages: mockSearchPixabayImages,
  searchWebImages: mockSearchWebImages,
}));

interface HookHarness {
  getValue: () => ReturnType<typeof useImageSearch>;
}

const mountedRoots: MountedRoot[] = [];

function mountHook(): HookHarness {
  let hookValue: ReturnType<typeof useImageSearch> | null = null;

  function TestComponent() {
    hookValue = useImageSearch();
    return null;
  }

  renderIntoDom(<TestComponent />, mountedRoots);

  return {
    getValue: () => {
      if (!hookValue) {
        throw new Error("hook 尚未初始化");
      }
      return hookValue;
    },
  };
}

beforeEach(() => {
  setReactActEnvironment();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanupMountedRoots(mountedRoots);
  vi.restoreAllMocks();
});

describe("useImageSearch", () => {
  it("应正确映射 Pixabay 结果", async () => {
    mockSearchPixabayImages.mockResolvedValue({
      total: 100,
      total_hits: 2,
      hits: [
        {
          id: 1,
          preview_url: "https://pixabay.example/preview.jpg",
          large_image_url: "https://pixabay.example/large.jpg",
          image_width: 1200,
          image_height: 800,
          tags: "forest,tree",
          page_url: "https://pixabay.com/photos/forest",
          user: "pixabay-user",
        },
      ],
    });

    const harness = mountHook();
    await act(async () => {
      await harness.getValue().search("pixabay", "forest", true);
    });

    const state = harness.getValue().sourceStates.pixabay;
    expect(state.total).toBe(2);
    expect(state.results).toHaveLength(1);
    expect(state.results[0]).toMatchObject({
      id: "1",
      previewUrl: "https://pixabay.example/preview.jpg",
      largeUrl: "https://pixabay.example/large.jpg",
      provider: "pixabay",
    });
  });

  it("应正确映射联网（Pexels）结果", async () => {
    mockSearchWebImages.mockResolvedValue({
      total: 1,
      provider: "pexels",
      hits: [
        {
          id: "pex-1",
          thumbnail_url: "https://pexels.example/thumb.jpg",
          content_url: "https://pexels.example/original.jpg",
          width: 1080,
          height: 1920,
          name: "city night",
          host_page_url: "https://www.pexels.com/photo/city-night",
        },
      ],
    });

    const harness = mountHook();
    await act(async () => {
      await harness.getValue().search("web", "city", true);
    });

    const state = harness.getValue().sourceStates.web;
    expect(state.total).toBe(1);
    expect(state.results).toHaveLength(1);
    expect(state.results[0]).toMatchObject({
      id: "pex-1",
      previewUrl: "https://pexels.example/thumb.jpg",
      largeUrl: "https://pexels.example/original.jpg",
      provider: "pexels",
      tags: "city night",
    });
  });

  it("应兼容联网（Pexels）camelCase 字段", async () => {
    mockSearchWebImages.mockResolvedValue({
      total: 2,
      provider: "pexels",
      hits: [
        {
          id: "pex-camel-1",
          thumbnailUrl: "https://pexels.example/camel-thumb.jpg",
          contentUrl: "https://pexels.example/camel-original.jpg",
          width: 1200,
          height: 800,
          name: "camel city",
          hostPageUrl: "https://www.pexels.com/photo/camel-city",
        },
      ],
    });

    const harness = mountHook();
    await act(async () => {
      await harness.getValue().search("web", "city", true);
    });

    const state = harness.getValue().sourceStates.web;
    expect(state.total).toBe(2);
    expect(state.results).toHaveLength(1);
    expect(state.results[0]).toMatchObject({
      id: "pex-camel-1",
      previewUrl: "https://pexels.example/camel-thumb.jpg",
      largeUrl: "https://pexels.example/camel-original.jpg",
      pageUrl: "https://www.pexels.com/photo/camel-city",
      provider: "pexels",
    });
  });

  it("loadMore 应使用下一页请求并追加结果", async () => {
    mockSearchPixabayImages.mockImplementation(async (req) => {
      const page = req.page;
      return {
        total: 40,
        total_hits: 40,
        hits: [
          {
            id: page,
            preview_url: `https://pixabay.example/${page}-preview.jpg`,
            large_image_url: `https://pixabay.example/${page}-large.jpg`,
            image_width: 1200,
            image_height: 800,
            tags: `tag-${page}`,
            page_url: `https://pixabay.com/photos/${page}`,
            user: "pixabay-user",
          },
        ],
      };
    });

    const harness = mountHook();
    await act(async () => {
      await harness.getValue().search("pixabay", "mountain", true);
    });

    await act(async () => {
      harness.getValue().loadMore("pixabay");
      await flushEffects();
    });

    await waitForCondition(
      () => harness.getValue().sourceStates.pixabay.results.length === 2,
      50,
      "分页加载未完成",
    );

    const state = harness.getValue().sourceStates.pixabay;
    expect(state.page).toBe(2);
    expect(state.results.map((item) => item.id)).toEqual(["1", "2"]);

    const pageCalls = mockSearchPixabayImages.mock.calls.map(
      ([req]) => req.page,
    );
    expect(pageCalls).toEqual([1, 2]);
  });

  it("应维护来源独立缓存（互不污染）", async () => {
    mockSearchPixabayImages.mockResolvedValue({
      total: 1,
      total_hits: 1,
      hits: [
        {
          id: 100,
          preview_url: "https://pixabay.example/p.jpg",
          large_image_url: "https://pixabay.example/l.jpg",
          image_width: 1000,
          image_height: 700,
          tags: "pixabay-only",
          page_url: "https://pixabay.com/photos/pixabay-only",
          user: "pix-user",
        },
      ],
    });
    mockSearchWebImages.mockResolvedValue({
      total: 1,
      provider: "pexels",
      hits: [
        {
          id: "w-1",
          thumbnail_url: "https://pexels.example/w-thumb.jpg",
          content_url: "https://pexels.example/w.jpg",
          width: 700,
          height: 1000,
          name: "web-only",
          host_page_url: "https://www.pexels.com/photo/web-only",
        },
      ],
    });

    const harness = mountHook();
    await act(async () => {
      await harness.getValue().search("pixabay", "pixabay-query", true);
    });
    await act(async () => {
      await harness.getValue().search("web", "web-query", true);
    });

    const pixabayState = harness.getValue().sourceStates.pixabay;
    const webState = harness.getValue().sourceStates.web;

    expect(pixabayState.results).toHaveLength(1);
    expect(pixabayState.results[0].provider).toBe("pixabay");
    expect(pixabayState.results[0].id).toBe("100");

    expect(webState.results).toHaveLength(1);
    expect(webState.results[0].provider).toBe("pexels");
    expect(webState.results[0].id).toBe("w-1");
  });
});
