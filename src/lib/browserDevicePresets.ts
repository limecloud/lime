export const browserDevicePresets = [
  {
    id: "responsive",
    width: 390,
    height: 844,
    label: "browserChrome.responsive",
  },
  { id: "4k", width: 2560, height: 1440, label: "browserChrome.preset4k" },
  {
    id: "laptop-l",
    width: 1440,
    height: 900,
    label: "browserChrome.presetLaptopLarge",
  },
  {
    id: "laptop",
    width: 1024,
    height: 768,
    label: "browserChrome.presetLaptop",
  },
  {
    id: "surface-pro-7",
    width: 912,
    height: 1368,
    label: "browserChrome.presetSurfacePro7",
  },
  {
    id: "ipad-air",
    width: 820,
    height: 1180,
    label: "browserChrome.presetIpadAir",
  },
  {
    id: "ipad-mini",
    width: 768,
    height: 1024,
    label: "browserChrome.presetIpadMini",
  },
  {
    id: "surface-duo",
    width: 540,
    height: 720,
    label: "browserChrome.presetSurfaceDuo",
  },
  {
    id: "iphone-15-pro-max",
    width: 430,
    height: 932,
    label: "browserChrome.presetIphone15ProMax",
  },
  {
    id: "pixel-8",
    width: 412,
    height: 915,
    label: "browserChrome.presetPixel8",
  },
  {
    id: "iphone-15-pro",
    width: 393,
    height: 852,
    label: "browserChrome.presetIphone15Pro",
  },
  {
    id: "samsung-galaxy-s24-ultra",
    width: 384,
    height: 824,
    label: "browserChrome.presetGalaxyS24Ultra",
  },
  {
    id: "iphone-se",
    width: 375,
    height: 667,
    label: "browserChrome.presetIphoneSe",
  },
] as const;

export type BrowserDevicePreset = (typeof browserDevicePresets)[number]["id"];

export function isBrowserDevicePreset(
  value: unknown,
): value is BrowserDevicePreset {
  return browserDevicePresets.some((preset) => preset.id === value);
}
