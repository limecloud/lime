import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { TokenUsageDisplay } from "./TokenUsageDisplay";

const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = [];

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) {
      continue;
    }
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
});

describe("TokenUsageDisplay", () => {
  it("应渲染总 token 数提示", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ container, root });

    act(() => {
      root.render(
        <TokenUsageDisplay
          usage={{
            input_tokens: 12_000,
            output_tokens: 19_000,
          }}
        />,
      );
    });

    expect(container.textContent).toContain("31.0K tokens");
  });

  it("应在不同数量级下渲染紧凑 token 文案", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ container, root });

    act(() => {
      root.render(
        <div>
          <TokenUsageDisplay
            usage={{
              input_tokens: 499,
              output_tokens: 500,
            }}
          />
          <TokenUsageDisplay
            usage={{
              input_tokens: 700,
              output_tokens: 500,
            }}
          />
          <TokenUsageDisplay
            usage={{
              input_tokens: 900_000,
              output_tokens: 300_000,
            }}
          />
        </div>,
      );
    });

    expect(container.textContent).toContain("999 tokens");
    expect(container.textContent).toContain("1.2K tokens");
    expect(container.textContent).toContain("1.2M tokens");
  });

  it("存在缓存命中时应在总 token 旁边展示缓存 token", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ container, root });

    act(() => {
      root.render(
        <TokenUsageDisplay
          usage={{
            input_tokens: 12_000,
            output_tokens: 19_000,
            cached_input_tokens: 8_000,
          }}
        />,
      );
    });

    expect(container.textContent).toContain("31.0K tokens");
    expect(container.textContent).toContain("缓存 8.0K");
  });

  it("存在缓存写入时应展示缓存总量与读写拆分", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ container, root });

    act(() => {
      root.render(
        <TokenUsageDisplay
          usage={{
            input_tokens: 12_000,
            output_tokens: 19_000,
            cached_input_tokens: 8_000,
            cache_creation_input_tokens: 1_200,
          }}
        />,
      );
    });

    expect(container.textContent).toContain("31.0K tokens");
    expect(container.textContent).toContain("缓存 9.2K");
    expect(container.textContent).toContain("读 8.0K / 写 1.2K");
  });

  it("存在缓存字段但未命中时也应在总 token 旁边展示缓存 token", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ container, root });

    act(() => {
      root.render(
        <TokenUsageDisplay
          usage={{
            input_tokens: 12_000,
            output_tokens: 19_000,
            cached_input_tokens: 0,
          }}
        />,
      );
    });

    expect(container.textContent).toContain("31.0K tokens");
    expect(container.textContent).toContain("缓存 0");
  });

  it("仅存在缓存写入时应抑制黄色提示并展示缓存写入", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ container, root });

    act(() => {
      root.render(
        <TokenUsageDisplay
          usage={{
            input_tokens: 12_000,
            output_tokens: 19_000,
            cached_input_tokens: 0,
            cache_creation_input_tokens: 1_200,
          }}
          promptCacheNotice={{
            label: "未声明自动缓存",
            detail:
              "当前 Provider 未声明支持自动 Prompt Cache；如需复用前缀，请使用显式 cache_control 标记。",
          }}
        />,
      );
    });

    expect(container.textContent).toContain("缓存 1.2K");
    expect(container.textContent).toContain("读 0 / 写 1.2K");
    expect(container.textContent).not.toContain("未声明自动缓存");
  });

  it("未启用自动缓存时应展示轻量诊断提示", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ container, root });

    act(() => {
      root.render(
        <TokenUsageDisplay
          usage={{
            input_tokens: 12_000,
            output_tokens: 19_000,
            cached_input_tokens: 0,
          }}
          promptCacheNotice={{
            label: "未声明自动缓存",
            detail:
              "当前 Provider 未声明支持自动 Prompt Cache；如需复用前缀，请使用显式 cache_control 标记。",
          }}
        />,
      );
    });

    expect(container.textContent).toContain("31.0K tokens");
    expect(container.textContent).toContain("未声明自动缓存");
    expect(container.firstElementChild?.getAttribute("title")).toContain(
      "未声明支持自动 Prompt Cache",
    );
  });
});
