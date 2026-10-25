import { Globe } from "lucide-react";
import type { ToolDisplayConfig } from "../toolDisplayTypes";

export const BROWSER_TOOL_MATCHERS: Array<{
  match: (name: string) => boolean;
  config: ToolDisplayConfig;
}> = [
  {
    match: (name) => name === "browserobserve",
    config: {
      family: "browser",
      label: "查看页面",
      labelKey: "toolCall.browser.observe",
      verb: "查看",
      icon: Globe,
      groupTitle: "浏览器",
      actionKey: "browser",
      actions: {
        failed: "查看失败",
        completed: "已查看",
        running: "正在查看",
      },
      actionKeys: {
        failed: "toolCall.browser.observeFailed",
        completed: "toolCall.browser.observed",
        running: "toolCall.browser.observing",
      },
    },
  },
  {
    match: (name) => name === "browsermarkdeliverable",
    config: {
      family: "browser",
      label: "保留页面",
      labelKey: "toolCall.browser.retain",
      verb: "操作",
      icon: Globe,
      groupTitle: "浏览器",
      actionKey: "browser",
      actions: {
        failed: "保留失败",
        completed: "已保留",
        running: "正在保留",
      },
      actionKeys: {
        failed: "toolCall.browser.retainFailed",
        completed: "toolCall.browser.retained",
        running: "toolCall.browser.retaining",
      },
    },
  },
  {
    match: (name) => name === "newtab" || name === "browsernewtab",
    config: {
      family: "browser",
      label: "页面打开",
      labelKey: "toolCall.browser.open",
      verb: "打开",
      icon: Globe,
      groupTitle: "浏览器",
      actionKey: "browser",
      actions: { failed: "打开失败", completed: "已打开", running: "打开中" },
      actionKeys: {
        failed: "toolCall.browser.failed",
        completed: "toolCall.browser.opened",
        running: "toolCall.browser.opening",
      },
    },
  },
  {
    match: (name) => name === "open",
    config: {
      family: "browser",
      label: "页面打开",
      verb: "打开",
      icon: Globe,
      groupTitle: "浏览器",
      actionKey: "browser",
      actions: {
        failed: "打开失败",
        completed: "已打开",
        running: "打开中",
      },
    },
  },
  {
    match: (name) => name.includes("navigateback"),
    config: {
      family: "browser",
      label: "页面返回",
      verb: "返回",
      icon: Globe,
      groupTitle: "浏览器",
      actionKey: "browser",
      actions: {
        failed: "返回失败",
        completed: "已返回",
        running: "返回中",
      },
    },
  },
  {
    match: (name) => name.includes("navigate") || name.includes("goto"),
    config: {
      family: "browser",
      label: "页面打开",
      verb: "打开",
      icon: Globe,
      groupTitle: "浏览器",
      actionKey: "browser",
      actions: {
        failed: "打开失败",
        completed: "已打开",
        running: "打开中",
      },
    },
  },
  {
    match: (name) => name.includes("click"),
    config: {
      family: "browser",
      label: "页面点击",
      verb: "点击",
      icon: Globe,
      groupTitle: "浏览器",
      actionKey: "browser",
      actions: {
        failed: "点击失败",
        completed: "已点击",
        running: "点击中",
      },
    },
  },
  {
    match: (name) => name.includes("hover"),
    config: {
      family: "browser",
      label: "页面定位",
      verb: "定位",
      icon: Globe,
      groupTitle: "浏览器",
      actionKey: "browser",
      actions: {
        failed: "定位失败",
        completed: "已定位",
        running: "定位中",
      },
    },
  },
  {
    match: (name) =>
      name.includes("type") ||
      name === "browserfill" ||
      name === "browserpress" ||
      name.includes("fillform") ||
      name.includes("presskey") ||
      name.includes("selectoption") ||
      name.includes("handledialog"),
    config: {
      family: "browser",
      label: "页面输入",
      verb: "填写",
      icon: Globe,
      groupTitle: "浏览器",
      actionKey: "browser",
      actions: {
        failed: "填写失败",
        completed: "已填写",
        running: "填写中",
      },
    },
  },
  {
    match: (name) => name.includes("drag"),
    config: {
      family: "browser",
      label: "页面拖拽",
      verb: "拖拽",
      icon: Globe,
      groupTitle: "浏览器",
      actionKey: "browser",
      actions: {
        failed: "拖拽失败",
        completed: "已拖拽",
        running: "拖拽中",
      },
    },
  },
  {
    match: (name) => name.includes("screenshot") || name.includes("snapshot"),
    config: {
      family: "browser",
      label: "页面截图",
      verb: "截图",
      icon: Globe,
      groupTitle: "浏览器",
      actionKey: "browser",
      actions: {
        failed: "截图失败",
        completed: "已截图",
        running: "截图中",
      },
    },
  },
  {
    match: (name) => name.includes("evaluate") || name.includes("runcode"),
    config: {
      family: "browser",
      label: "页面脚本",
      verb: "执行脚本",
      icon: Globe,
      groupTitle: "浏览器",
      actionKey: "browser",
      actions: {
        failed: "脚本执行失败",
        completed: "已执行脚本",
        running: "执行脚本中",
      },
    },
  },
  {
    match: (name) =>
      name.includes("consolemessages") || name.includes("networkrequests"),
    config: {
      family: "browser",
      label: "页面日志",
      verb: "获取日志",
      icon: Globe,
      groupTitle: "浏览器",
      actionKey: "browser",
      actions: {
        failed: "获取日志失败",
        completed: "已获取日志",
        running: "获取日志中",
      },
    },
  },
  {
    match: (name) =>
      name.includes("waitfor") ||
      name.includes("tabs") ||
      name.includes("resize") ||
      name.includes("install") ||
      name.includes("fileupload") ||
      name.includes("close") ||
      name.startsWith("browser"),
    config: {
      family: "browser",
      label: "浏览器操作",
      verb: "操作",
      icon: Globe,
      groupTitle: "浏览器",
      actionKey: "browser",
    },
  },
];
