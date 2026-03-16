export type ExistingSessionAttachStatusInfo = {
  label: string;
  toneClass: string;
  description: string;
};

export type ExistingSessionAttachPresentation = {
  observerConnected: boolean;
  statusInfo: ExistingSessionAttachStatusInfo;
  placeholder: string;
  embeddedActionLabel: string;
  contextActionLabel: string;
  pageActionLabel: string;
  tabsActionLabel: string;
  embeddedControlHint: string;
  liveViewHint: string;
};

export function buildExistingSessionAttachPresentation(params: {
  loading: boolean;
  observerConnected: boolean;
  pageLoading: boolean;
  tabsLoading: boolean;
}): ExistingSessionAttachPresentation {
  const { loading, observerConnected, pageLoading, tabsLoading } = params;

  let statusInfo: ExistingSessionAttachStatusInfo;
  if (loading) {
    statusInfo = {
      label: "检查桥接中",
      toneClass:
        "border-sky-300/70 bg-sky-50 text-sky-800 dark:border-sky-800/70 dark:bg-sky-950/30 dark:text-sky-200",
      description: "正在确认当前 Chrome 是否已经连接 Proxycast Browser Bridge。",
    };
  } else if (!observerConnected) {
    statusInfo = {
      label: "等待桥接",
      toneClass:
        "border-orange-300/70 bg-orange-50 text-orange-800 dark:border-orange-800/70 dark:bg-orange-950/30 dark:text-orange-200",
      description:
        "当前资料为附着当前 Chrome 模式。请先在你正在使用的 Chrome 中连接 Proxycast Browser Bridge 扩展。",
    };
  } else if (pageLoading) {
    statusInfo = {
      label: "读取页面中",
      toneClass:
        "border-sky-300/70 bg-sky-50 text-sky-800 dark:border-sky-800/70 dark:bg-sky-950/30 dark:text-sky-200",
      description: "正在同步当前 Chrome 页面的标题、URL 和页面摘要。",
    };
  } else {
    statusInfo = {
      label: "附着当前 Chrome",
      toneClass:
        "border-emerald-300/70 bg-emerald-50 text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950/30 dark:text-emerald-200",
      description:
        "当前资料直接复用你正在使用的 Chrome 页面，不会额外启动独立 CDP 会话；可读取页面摘要并切换标签页。",
    };
  }

  let placeholder = "附着当前 Chrome 模式暂不提供实时画面；可读取当前页面摘要、查看标签页并切换到目标页面。";
  if (loading) {
    placeholder = "正在检查当前 Chrome 的桥接连接...";
  } else if (!observerConnected) {
    placeholder =
      "当前资料配置为附着当前 Chrome。请先在当前浏览器安装并连接 Proxycast Browser Bridge 扩展。";
  } else if (pageLoading) {
    placeholder = "正在读取当前 Chrome 的页面摘要...";
  }

  return {
    observerConnected,
    statusInfo,
    placeholder,
    embeddedActionLabel: pageLoading
      ? "读取中"
      : loading
        ? "检测中"
        : observerConnected
          ? "读取页面"
          : "刷新桥接",
    contextActionLabel: loading ? "刷新中..." : "刷新桥接状态",
    pageActionLabel: pageLoading ? "读取中..." : "读取当前页面",
    tabsActionLabel: tabsLoading ? "读取中..." : "读取标签页",
    embeddedControlHint: observerConnected
      ? "附着模式已连接：可读取页面摘要，并在高级调试里切换当前 Chrome 标签页。"
      : "当前资料为附着模式，请先连接 Proxycast Browser Bridge 扩展。",
    liveViewHint: observerConnected
      ? "附着模式当前不采集实时画面，可在高级调试里读取页面摘要并切换标签页。"
      : "当前资料为附着模式，请先连接 Proxycast Browser Bridge 扩展。",
  };
}
