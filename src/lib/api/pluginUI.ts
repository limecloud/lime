/**
 * 插件 UI API
 *
 * 提供插件 UI 注册系统的前端 API 调用
 * 用于获取带有 UI 配置的已安装插件列表
 *
 * _需求: 3.1_
 */

import { safeInvoke } from "@/lib/dev-bridge";

const PLUGIN_UI_CHANGE_EVENT = "plugin-changed";

let pluginsWithUICache: PluginUIInfo[] | null = null;
let pluginsWithUILoadingPromise: Promise<PluginUIInfo[]> | null = null;
let pluginsWithUICacheStamp: string | null = null;

/**
 * 插件 UI 信息
 *
 * 描述带有 UI 配置的插件信息
 */
export interface PluginUIInfo {
  /** 插件 ID */
  pluginId: string;
  /** 插件名称 */
  name: string;
  /** 插件描述 */
  description: string;
  /** 图标名称 (Lucide 图标) */
  icon: string;
  /** UI 展示位置列表 (如 "tools", "sidebar", "main") */
  surfaces: string[];
}

interface PluginUIQueryOptions {
  forceRefresh?: boolean;
}

function clonePluginList(plugins: PluginUIInfo[]): PluginUIInfo[] {
  return plugins.map((plugin) => ({
    ...plugin,
    surfaces: [...plugin.surfaces],
  }));
}

function readPluginUIChangeStamp(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage.getItem(PLUGIN_UI_CHANGE_EVENT);
  } catch {
    return null;
  }
}

export function invalidatePluginUICache(): void {
  pluginsWithUICache = null;
  pluginsWithUILoadingPromise = null;
  pluginsWithUICacheStamp = null;
}

export function notifyPluginUIChanged(): void {
  invalidatePluginUICache();

  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(PLUGIN_UI_CHANGE_EVENT, String(Date.now()));
  } catch {
    // ignore
  }

  window.dispatchEvent(new CustomEvent(PLUGIN_UI_CHANGE_EVENT));
}

/**
 * 获取带有 UI 配置的已安装插件列表
 *
 * 从已安装插件中筛选带有 UI 配置的插件
 * 返回 PluginUIInfo 列表，用于在工具页面或侧边栏显示
 *
 * @returns 带有 UI 配置的插件列表
 */
export async function getPluginsWithUI(
  options: PluginUIQueryOptions = {},
): Promise<PluginUIInfo[]> {
  if (options.forceRefresh) {
    invalidatePluginUICache();
  }

  const currentStamp = readPluginUIChangeStamp();
  if (pluginsWithUICache && pluginsWithUICacheStamp !== currentStamp) {
    invalidatePluginUICache();
  }

  if (pluginsWithUICache) {
    return clonePluginList(pluginsWithUICache);
  }

  if (!pluginsWithUILoadingPromise) {
    pluginsWithUILoadingPromise = safeInvoke<PluginUIInfo[]>(
      "get_plugins_with_ui",
    )
      .then((plugins) => {
        const snapshot = clonePluginList(plugins);
        pluginsWithUICache = snapshot;
        pluginsWithUICacheStamp = readPluginUIChangeStamp();
        return snapshot;
      })
      .finally(() => {
        pluginsWithUILoadingPromise = null;
      });
  }

  return clonePluginList(await pluginsWithUILoadingPromise);
}

/**
 * 获取指定 surface 的插件列表
 *
 * 筛选出在指定 surface 上显示的插件
 *
 * @param surface - UI 展示位置 (如 "tools", "sidebar", "main")
 * @returns 在指定 surface 上显示的插件列表
 */
export async function getPluginsForSurface(
  surface: string,
  options: PluginUIQueryOptions = {},
): Promise<PluginUIInfo[]> {
  const plugins = await getPluginsWithUI(options);
  return plugins.filter((plugin) => plugin.surfaces.includes(surface));
}
