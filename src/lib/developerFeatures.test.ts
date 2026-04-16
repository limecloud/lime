import { beforeEach, describe, expect, it } from "vitest";
import {
  WORKSPACE_HARNESS_DEBUG_OVERRIDE_KEY,
  readWorkspaceHarnessDebugOverride,
  resolveWorkspaceHarnessEnabled,
} from "./developerFeatures";

describe("developerFeatures", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("未设置调试覆盖时应返回 null", () => {
    expect(readWorkspaceHarnessDebugOverride()).toBeNull();
  });

  it("应识别处理工作台调试覆盖开关", () => {
    window.localStorage.setItem(WORKSPACE_HARNESS_DEBUG_OVERRIDE_KEY, "true");
    expect(readWorkspaceHarnessDebugOverride()).toBe(true);

    window.localStorage.setItem(WORKSPACE_HARNESS_DEBUG_OVERRIDE_KEY, "off");
    expect(readWorkspaceHarnessDebugOverride()).toBe(false);
  });

  it("调试覆盖存在时应优先于配置值", () => {
    window.localStorage.setItem(WORKSPACE_HARNESS_DEBUG_OVERRIDE_KEY, "1");

    expect(
      resolveWorkspaceHarnessEnabled({
        developer: { workspace_harness_enabled: false },
      }),
    ).toBe(true);
  });

  it("没有调试覆盖时应回退到配置值", () => {
    expect(
      resolveWorkspaceHarnessEnabled({
        developer: { workspace_harness_enabled: true },
      }),
    ).toBe(true);
    expect(
      resolveWorkspaceHarnessEnabled({
        developer: { workspace_harness_enabled: false },
      }),
    ).toBe(false);
  });
});
