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
});
