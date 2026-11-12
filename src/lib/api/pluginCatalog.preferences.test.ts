import { describe, expect, it, vi } from "vitest";
import {
  PLUGIN_CATALOG_CHANGED_EVENT,
  setPluginEnabled,
  setPluginSkillEnabled,
} from "./pluginCatalog";

// Cloud distributes packages. Local configuration owns enablement even offline.
describe("installed plugin preferences", () => {
  it("安装的云端插件以完整身份写入本地配置，无需云端账号", async () => {
    const api = { request: vi.fn().mockResolvedValue({ result: {} }) };
    const listener = vi.fn();
    window.addEventListener(PLUGIN_CATALOG_CHANGED_EVENT, listener);
    try {
      await setPluginEnabled(
        { pluginId: "writer@lime-cloud-publisher", enabled: false },
        api,
      );
      expect(api.request).toHaveBeenCalledWith("config/batchWrite", {
        edits: [
          {
            keyPath: 'plugins."writer@lime-cloud-publisher".enabled',
            value: false,
            mergeStrategy: "replace",
          },
        ],
        reloadUserConfig: true,
      });
      expect(listener).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener(PLUGIN_CATALOG_CHANGED_EVENT, listener);
    }
  });

  it("技能偏好使用实际安装路径，保留失败并且不发成功事件", async () => {
    const path = "/work/cache/writer/skills/原文研究/SKILL.md";
    const api = {
      writeSkillsConfig: vi.fn().mockResolvedValue({ result: {} }),
    };
    const listener = vi.fn();
    window.addEventListener(PLUGIN_CATALOG_CHANGED_EVENT, listener);
    try {
      await setPluginSkillEnabled({ path, enabled: false }, api);
      expect(api.writeSkillsConfig).toHaveBeenCalledWith({
        path,
        enabled: false,
      });
      expect(listener).toHaveBeenCalledOnce();
      listener.mockClear();
      api.writeSkillsConfig.mockRejectedValueOnce(new Error("write denied"));
      await expect(
        setPluginSkillEnabled({ path, enabled: true }, api),
      ).rejects.toThrow("write denied");
      expect(listener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(PLUGIN_CATALOG_CHANGED_EVENT, listener);
    }
  });

  it("配置写入失败不发布目录更新", async () => {
    const api = {
      request: vi.fn().mockRejectedValue(new Error("write denied")),
    };
    const listener = vi.fn();
    window.addEventListener(PLUGIN_CATALOG_CHANGED_EVENT, listener);
    try {
      await expect(
        setPluginEnabled({ pluginId: "writer@local", enabled: true }, api),
      ).rejects.toThrow("write denied");
      expect(listener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(PLUGIN_CATALOG_CHANGED_EVENT, listener);
    }
  });
});
