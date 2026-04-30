import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LIME_COLOR_SCHEME_ID,
  LIME_COLOR_SCHEME_CHANGED_EVENT,
  LIME_COLOR_SCHEMES,
  LIME_COLOR_SCHEME_STORAGE_KEY,
  applyLimeColorScheme,
  persistLimeColorScheme,
  resolveLimeColorSchemeId,
} from "./colorSchemes";

afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("data-lime-theme-effective");
  document.documentElement.removeAttribute("data-lime-color-scheme");
  document.documentElement.removeAttribute("style");
});

describe("colorSchemes", () => {
  it("未知配色应回退到 Lime 经典", () => {
    expect(resolveLimeColorSchemeId("unknown")).toBe(
      DEFAULT_LIME_COLOR_SCHEME_ID,
    );
    expect(resolveLimeColorSchemeId(null)).toBe(DEFAULT_LIME_COLOR_SCHEME_ID);
  });

  it("应提供参考图中的完整预设配色矩阵", () => {
    expect(LIME_COLOR_SCHEMES.map((scheme) => scheme.label)).toEqual([
      "墨绿",
      "自然",
      "海洋",
      "复古",
      "霓虹",
      "青柠",
      "黄昏",
      "极简",
      "活力",
      "文艺",
      "奢华",
    ]);
    expect(
      LIME_COLOR_SCHEMES.every((scheme) => scheme.swatches.length === 3),
    ).toBe(true);
  });

  it("应用配色时应写入根节点 dataset 与 CSS 变量", () => {
    const resolvedId = applyLimeColorScheme("lime-sand");

    expect(resolvedId).toBe("lime-sand");
    expect(document.documentElement.dataset.limeColorScheme).toBe("lime-sand");
    expect(
      document.documentElement.style.getPropertyValue("--lime-chrome-rail"),
    ).toBe("#f4f0e7");
    expect(
      document.documentElement.style.getPropertyValue("--lime-stage-surface"),
    ).toContain("#fbfaf4");
    expect(
      document.documentElement.style.getPropertyValue(
        "--lime-chrome-stage-blend",
      ),
    ).toContain("#fbfaf4");
    expect(
      document.documentElement.style.getPropertyValue(
        "--lime-chrome-stage-seam",
      ),
    ).toBe("rgba(84, 104, 76, 0.075)");
    expect(
      document.documentElement.style.getPropertyValue("--lime-sidebar-surface"),
    ).toContain("#eee9dd");
  });

  it("深色主题下切换配色时应继续保留深色表面变量", () => {
    document.documentElement.classList.add("dark");
    document.documentElement.dataset.limeThemeEffective = "dark";

    const resolvedId = applyLimeColorScheme("lime-ocean");

    expect(resolvedId).toBe("lime-ocean");
    expect(document.documentElement.dataset.limeColorScheme).toBe("lime-ocean");
    expect(
      document.documentElement.style.getPropertyValue("--lime-app-bg"),
    ).toBe("#0b1120");
    expect(
      document.documentElement.style.getPropertyValue("--lime-surface"),
    ).toBe("#0f172a");
    expect(
      document.documentElement.style.getPropertyValue("--lime-brand-strong"),
    ).toBe("#86efac");
  });

  it("持久化配色时应写 localStorage 并派发变更事件", () => {
    const listener = vi.fn();
    window.addEventListener(LIME_COLOR_SCHEME_CHANGED_EVENT, listener);

    const resolvedId = persistLimeColorScheme("lime-luxury");

    expect(resolvedId).toBe("lime-luxury");
    expect(localStorage.getItem(LIME_COLOR_SCHEME_STORAGE_KEY)).toBe(
      "lime-luxury",
    );
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toMatchObject({
      detail: { colorSchemeId: "lime-luxury" },
    });

    window.removeEventListener(LIME_COLOR_SCHEME_CHANGED_EVENT, listener);
  });
});
