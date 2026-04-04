import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AppTabs } from "./AppTabs";

describe("clients/AppTabs", () => {
  it("应展示 current 的 Claude 标签，不再回流旧品牌名称", () => {
    const html = renderToStaticMarkup(
      <AppTabs activeApp="claude" onAppChange={vi.fn()} />,
    );

    expect(html).toContain("Claude");
    expect(html).toContain("Claude 配置");
    expect(html).not.toContain("Claude Code");
  });
});
