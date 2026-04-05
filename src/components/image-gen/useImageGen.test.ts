/**
 * @file useImageGen Fal 调用测试
 * @description 验证 Fal 图片生成关键回退链路
 * @module components/image-gen/useImageGen.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __imageGenFalTestUtils } from "./useImageGen";
import { silenceConsole } from "./test-utils";

const {
  buildFalInput,
  requestImageFromFal,
  resolveFalEndpointModelCandidates,
} = __imageGenFalTestUtils;

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createTextResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}

describe("useImageGen Fal 调用链路", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    silenceConsole();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("nano-banana-pro 同步请求应使用官方 schema", async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({
        images: [{ url: "https://cdn.example.com/sync-ok.png" }],
      }),
    );

    const imageUrl = await requestImageFromFal(
      "https://fal.run",
      "test-fal-key",
      "fal-ai/nano-banana-pro",
      "a red apple",
      [],
      "1024x1024",
    );

    expect(imageUrl).toBe("https://cdn.example.com/sync-ok.png");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://fal.run/fal-ai/nano-banana-pro",
    );

    const requestInit = fetchMock.mock.calls[0]?.[1] as {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    };
    expect(requestInit?.method).toBe("POST");
    expect(requestInit?.headers).toMatchObject({
      Authorization: "Key test-fal-key",
    });

    const payload = JSON.parse(requestInit?.body ?? "{}") as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      prompt: "a red apple",
      num_images: 1,
      aspect_ratio: "1:1",
      output_format: "png",
      safety_tolerance: "4",
    });
    expect(payload).not.toHaveProperty("image_size");
    expect(payload).not.toHaveProperty("enable_safety_checker");
    expect(payload).not.toHaveProperty("image_url");
    expect(payload).not.toHaveProperty("image_urls");
  });

  it("1792x1024 应映射为 Fal 支持的 16:9，而不是 7:4", () => {
    const payload = buildFalInput(
      "a spring cafe",
      [],
      "1792x1024",
      "fal-ai/nano-banana-pro",
      true,
    ) as Record<string, unknown>;

    expect(payload.aspect_ratio).toBe("16:9");
  });

  it("Fal Host 带 /fal-ai 历史路径时应自动归一化，避免重复拼接", async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({
        images: [{ url: "https://cdn.example.com/normalized-host.png" }],
      }),
    );

    const imageUrl = await requestImageFromFal(
      "https://fal.run/fal-ai",
      "test-fal-key",
      "fal-ai/nano-banana-pro",
      "normalize host",
      [],
      "1024x1024",
    );

    expect(imageUrl).toBe("https://cdn.example.com/normalized-host.png");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://fal.run/fal-ai/nano-banana-pro",
    );
  });

  it("nano-banana 遇到过短 prompt 时应自动扩写，避免服务端 422", () => {
    const payload = buildFalInput(
      "春天",
      [],
      "1024x1024",
      "fal-ai/nano-banana-pro",
      true,
    ) as Record<string, unknown>;

    expect(payload.prompt).toBe("请围绕“春天”生成一张图像");
  });

  it("同步失败后应回退到 /response 结果地址并返回图片", async () => {
    fetchMock
      .mockResolvedValueOnce(createTextResponse("sync primary failed", 500))
      .mockResolvedValueOnce(createJsonResponse({ request_id: "req-1" }, 200))
      .mockResolvedValueOnce(createJsonResponse({ status: "COMPLETED" }))
      .mockResolvedValueOnce(
        createJsonResponse({
          images: [{ url: "https://cdn.example.com/queue-ok.png" }],
        }),
      );

    const imageUrl = await requestImageFromFal(
      "https://fal.run",
      "test-fal-key",
      "fal-ai/nano-banana-pro",
      "a robot cat",
      [],
      "1024x1024",
    );

    expect(imageUrl).toBe("https://cdn.example.com/queue-ok.png");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://queue.fal.run/fal-ai/nano-banana-pro",
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "https://queue.fal.run/fal-ai/nano-banana-pro/requests/req-1/status",
    );
    expect(fetchMock.mock.calls[3]?.[0]).toBe(
      "https://queue.fal.run/fal-ai/nano-banana-pro/requests/req-1/response",
    );
  });

  it("带参考图时应先尝试 /edit，再回退基础端点且基础端点不应继续携带 edit 图参", async () => {
    const endpointCandidates = resolveFalEndpointModelCandidates(
      "fal-ai/nano-banana-pro",
      true,
    );
    expect(endpointCandidates).toEqual([
      "fal-ai/nano-banana-pro/edit",
      "fal-ai/nano-banana-pro",
    ]);

    fetchMock
      .mockResolvedValueOnce(createTextResponse("edit primary failed", 404))
      .mockResolvedValueOnce(createTextResponse("edit queue failed", 500))
      .mockResolvedValueOnce(
        createJsonResponse({
          images: [{ url: "https://cdn.example.com/base-fallback.png" }],
        }),
      );

    const imageUrl = await requestImageFromFal(
      "https://fal.run",
      "test-fal-key",
      "fal-ai/nano-banana-pro",
      "edit this image",
      ["https://cdn.example.com/reference.png"],
      "1024x1024",
    );

    expect(imageUrl).toBe("https://cdn.example.com/base-fallback.png");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://fal.run/fal-ai/nano-banana-pro/edit",
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "https://fal.run/fal-ai/nano-banana-pro",
    );

    const editPayload = JSON.parse(
      (fetchMock.mock.calls[0]?.[1] as { body?: string })?.body ?? "{}",
    ) as Record<string, unknown>;
    const basePayload = JSON.parse(
      (fetchMock.mock.calls[2]?.[1] as { body?: string })?.body ?? "{}",
    ) as Record<string, unknown>;

    expect(editPayload).toMatchObject({
      image_urls: ["https://cdn.example.com/reference.png"],
    });
    expect(basePayload).not.toHaveProperty("image_urls");
    expect(basePayload).not.toHaveProperty("image_url");
  });
});
