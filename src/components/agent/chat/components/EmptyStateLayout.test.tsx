import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
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
});
