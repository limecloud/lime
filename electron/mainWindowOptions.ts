import type { BrowserWindowConstructorOptions } from "electron";
import process from "node:process";

export type MainWindowChromeOptions = Pick<
  BrowserWindowConstructorOptions,
  "titleBarStyle" | "trafficLightPosition"
>;

export type MainWindowStartupOptions = Pick<
  BrowserWindowConstructorOptions,
  "backgroundColor" | "show"
>;

export function buildMainWindowStartupOptions(): MainWindowStartupOptions {
  return {
    backgroundColor: "#fcfcfc",
    show: false,
  };
}

export function buildMainWindowChromeOptions(
  platform: typeof process.platform = process.platform,
): MainWindowChromeOptions {
  if (platform !== "darwin") {
    return {};
  }

  return {
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 15 },
  };
}
