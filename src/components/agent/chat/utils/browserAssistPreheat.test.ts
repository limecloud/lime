import { describe, expect, it, vi } from "vitest";

import {
  preheatBrowserAssistInBackground,
  shouldPreheatBrowserAssist,
} from "./browserAssistPreheat";

describe("browserAssistPreheat", () => {
  it("无显式 URL 但存在浏览器意图时也应触发预热", () => {
    expect(
      shouldPreheatBrowserAssist(
        "打开百度新闻，并把实时浏览器画面显示在右侧画布中。",
      ),
    ).toBe(true);
  });

  it("通用模式下应以 best-effort 方式后台预热浏览器协助", () => {
    const ensureBrowserAssistCanvas = vi.fn(async () => true);

    const started = preheatBrowserAssistInBackground({
      activeTheme: "general",
      sourceText: "打开百度新闻，并把实时浏览器画面显示在右侧画布中。",
      ensureBrowserAssistCanvas,
    });

    expect(started).toBe(true);
    expect(ensureBrowserAssistCanvas).toHaveBeenCalledWith(
      "打开百度新闻，并把实时浏览器画面显示在右侧画布中。",
      {
        silent: true,
        navigationMode: "best-effort",
      },
    );
  });

  it("无浏览器意图时不应触发预热", () => {
    const ensureBrowserAssistCanvas = vi.fn(async () => true);

    const started = preheatBrowserAssistInBackground({
      activeTheme: "general",
      sourceText: "帮我总结一下这段会议纪要，并整理成三点结论。",
      ensureBrowserAssistCanvas,
    });

    expect(started).toBe(false);
    expect(ensureBrowserAssistCanvas).not.toHaveBeenCalled();
  });

  it("预热失败时不应同步抛错，并应走错误回调", async () => {
    const onError = vi.fn();
    let rejectEnsure: ((error: unknown) => void) | null = null;
    const ensureBrowserAssistCanvas = vi.fn(
      () =>
        new Promise<boolean>((_resolve, reject) => {
          rejectEnsure = reject;
        }),
    );

    expect(() =>
      preheatBrowserAssistInBackground({
        activeTheme: "general",
        sourceText: "打开 https://example.com",
        ensureBrowserAssistCanvas,
        onError,
      }),
    ).not.toThrow();

    expect(rejectEnsure).not.toBeNull();
    if (rejectEnsure) {
      (rejectEnsure as (error: unknown) => void)(new Error("launch failed"));
    }
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });
});
