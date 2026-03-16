import { describe, expect, it } from "vitest";
import { buildExistingSessionAttachPresentation } from "./existingSessionAttachPresentation";

describe("existingSessionAttachPresentation", () => {
  it("检查桥接中时应返回检测态文案", () => {
    const presentation = buildExistingSessionAttachPresentation({
      loading: true,
      observerConnected: false,
      pageLoading: false,
      tabsLoading: false,
    });

    expect(presentation.statusInfo.label).toBe("检查桥接中");
    expect(presentation.placeholder).toContain("正在检查当前 Chrome");
    expect(presentation.embeddedActionLabel).toBe("检测中");
    expect(presentation.contextActionLabel).toBe("刷新中...");
  });

  it("未连接 observer 时应返回桥接引导文案", () => {
    const presentation = buildExistingSessionAttachPresentation({
      loading: false,
      observerConnected: false,
      pageLoading: false,
      tabsLoading: false,
    });

    expect(presentation.statusInfo.label).toBe("等待桥接");
    expect(presentation.placeholder).toContain("附着当前 Chrome");
    expect(presentation.embeddedControlHint).toContain(
      "请先连接 Proxycast Browser Bridge 扩展",
    );
    expect(presentation.liveViewHint).toContain(
      "请先连接 Proxycast Browser Bridge 扩展",
    );
  });

  it("已连接后应返回读取与切页相关文案", () => {
    const presentation = buildExistingSessionAttachPresentation({
      loading: false,
      observerConnected: true,
      pageLoading: false,
      tabsLoading: true,
    });

    expect(presentation.statusInfo.label).toBe("附着当前 Chrome");
    expect(presentation.embeddedActionLabel).toBe("读取页面");
    expect(presentation.pageActionLabel).toBe("读取当前页面");
    expect(presentation.tabsActionLabel).toBe("读取中...");
  });
});
