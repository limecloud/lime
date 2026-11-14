import { describe, expect, it } from "vitest";

import {
  buildMainWindowChromeOptions,
  buildMainWindowStartupOptions,
} from "./mainWindowOptions";

describe("main window chrome options", () => {
  it("主窗口应先隐藏并使用稳定底色，等待正式界面首帧后再显示", () => {
    expect(buildMainWindowStartupOptions()).toEqual({
      backgroundColor: "#fcfcfc",
      show: false,
    });
  });

  it("macOS 主窗口隐藏系统标题栏并保留红绿灯按钮", () => {
    expect(buildMainWindowChromeOptions("darwin")).toEqual({
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 16, y: 15 },
    });
  });

  it("非 macOS 平台沿用系统默认窗口 chrome", () => {
    expect(buildMainWindowChromeOptions("win32")).toEqual({});
    expect(buildMainWindowChromeOptions("linux")).toEqual({});
  });
});
