import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tauri-runtime", () => ({
  hasTauriInvokeCapability: vi.fn(() => false),
  hasTauriRuntimeMarkers: vi.fn(() => false),
}));

import {
  hasTauriInvokeCapability,
  hasTauriRuntimeMarkers,
} from "@/lib/tauri-runtime";
import { shouldDisableStyledCssomInjection } from "./styledRuntime";

describe("shouldDisableStyledCssomInjection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasTauriInvokeCapability).mockReturnValue(false);
    vi.mocked(hasTauriRuntimeMarkers).mockReturnValue(false);
  });

  it("浏览器模式下应保持 CSSOM 注入开启", () => {
    expect(shouldDisableStyledCssomInjection()).toBe(false);
  });

  it("检测到 Tauri runtime marker 时应关闭 CSSOM 注入", () => {
    vi.mocked(hasTauriRuntimeMarkers).mockReturnValue(true);

    expect(shouldDisableStyledCssomInjection()).toBe(true);
  });

  it("检测到 Tauri invoke 能力时应关闭 CSSOM 注入", () => {
    vi.mocked(hasTauriInvokeCapability).mockReturnValue(true);

    expect(shouldDisableStyledCssomInjection()).toBe(true);
  });
});
