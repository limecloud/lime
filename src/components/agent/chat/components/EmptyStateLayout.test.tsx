import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { LIME_BRAND_LOGO_SRC } from "@/lib/branding";
import { EmptyStateLayout } from "./EmptyStateLayout";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("EmptyStateLayout", () => {
  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "%s 首页使用 Lime icon、简短标题和同一输入区",
    async (locale) => {
      await changeLimeLocale(locale);
      const host = document.createElement("div");
      document.body.appendChild(host);
      const root = createRoot(host);
      try {
        act(() =>
          root.render(
            <EmptyStateLayout
              composer={<div data-testid="home-composer">输入区</div>}
            />,
          ),
        );
        const image = host.querySelector("img");
        expect(image?.getAttribute("src")).toBe(LIME_BRAND_LOGO_SRC);
        expect(host.querySelectorAll("img")).toHaveLength(1);
        expect(host.querySelector("h1")?.textContent).toBeTruthy();
        expect(host.querySelector("h1")?.textContent).not.toContain(
          "agentChat.",
        );
        expect(
          host.querySelector('[data-testid="home-composer"]'),
        ).toBeTruthy();
        expect(host.querySelector("canvas")).toBeNull();
      } finally {
        act(() => root.unmount());
        host.remove();
      }
    },
  );

  it("有当前项目时标题带上项目名，空白项目名回到无项目标题", async () => {
    await changeLimeLocale("en-US");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      act(() =>
        root.render(
          <EmptyStateLayout
            composer={<div data-testid="home-composer">输入区</div>}
            projectName="Lime"
          />,
        ),
      );
      expect(host.querySelector("h1")?.textContent).toBe(
        "What should we build in Lime?",
      );
      expect(
        host.querySelector('[data-testid="home-hero-project-select"]'),
      ).toBeNull();

      act(() =>
        root.render(
          <EmptyStateLayout
            composer={<div data-testid="home-composer">输入区</div>}
            projectName="   "
          />,
        ),
      );
      expect(host.querySelector("h1")?.textContent).toBe(
        "What should we build?",
      );
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });

  it("项目名是标题内联按钮，点击交给 Composer 项目选择器", async () => {
    await changeLimeLocale("en-US");
    const onProjectSelect = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      act(() =>
        root.render(
          <EmptyStateLayout
            composer={<div data-testid="home-composer">输入区</div>}
            projectName="Lime"
            onProjectSelect={onProjectSelect}
          />,
        ),
      );
      const button = host.querySelector<HTMLButtonElement>(
        '[data-testid="home-hero-project-select"]',
      );
      expect(button?.tagName).toBe("BUTTON");
      expect(button?.textContent).toBe("Lime");
      expect(host.querySelector("h1")?.textContent).toBe(
        "What should we build in Lime?",
      );
      act(() => button?.click());
      expect(onProjectSelect).toHaveBeenCalledTimes(1);
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });
});
