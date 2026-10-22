import type { WorkspaceRightSurfaceKind } from "./rightSurfaceTypes";

export interface ThreadSidePanelTab {
  tabId: string;
  kind: WorkspaceRightSurfaceKind;
  filePath?: string | null;
  contentInstance?: string;
  dndId?: string;
  title?: string;
  browser?: {
    tabId: string;
    viewId: string;
    browserSessionId: string;
    threadId: string;
    webContentsId: number;
    ownerWebContentsId: number;
    windowId: number;
    url: string;
    faviconUrl: string | null;
    isLoading: boolean;
    audioMuted: boolean;
    selected: boolean;
  };
  backgroundTerminal?: { threadId: string; turnId: string; itemId: string };
}

export interface ThreadSidePanelTabs {
  tabs: readonly ThreadSidePanelTab[];
  activeTabId: string | null;
  open: boolean;
  // 显示状态不改变内容对象，固定预览时继续复用编辑器和草稿身份。
  previewTabId?: string | null;
}

export interface FileSelectionOptions {
  isPreview?: boolean;
}

export function pinSidePanelTab(
  state: ThreadSidePanelTabs,
  tabId: string,
): ThreadSidePanelTabs {
  return state.previewTabId === tabId
    ? { ...state, previewTabId: null }
    : state;
}

export function activeSidePanelTab(state: ThreadSidePanelTabs) {
  return state.tabs.find((tab) => tab.tabId === state.activeTabId) ?? null;
}

export function openSidePanelTab(
  state: ThreadSidePanelTabs,
  tab: ThreadSidePanelTab,
  replaceTabId?: string,
): ThreadSidePanelTabs {
  const replaceIndex = replaceTabId
    ? state.tabs.findIndex((item) => item.tabId === replaceTabId)
    : -1;
  // 延迟菜单动作不得重新打开已经关闭或已被替换的 New tab。
  if (
    replaceTabId &&
    (replaceIndex < 0 || state.tabs[replaceIndex].kind !== "workspace-new-tab")
  ) {
    return state;
  }
  const existing =
    tab.kind === "workspace-new-tab"
      ? null
      : state.tabs.find((item) =>
          tab.kind === "files" ||
          tab.kind === "shell" ||
          tab.kind === "browser" ||
          tab.kind === "background-terminal"
            ? item.tabId === tab.tabId
            : item.kind === tab.kind,
        );
  if (existing) {
    if (!replaceTabId && state.open && state.activeTabId === existing.tabId)
      return state;
    return {
      ...state,
      tabs: state.tabs.filter((item) => item.tabId !== replaceTabId),
      activeTabId: existing.tabId,
      open: true,
    };
  }
  const tabs = [...state.tabs];
  if (replaceIndex >= 0) tabs.splice(replaceIndex, 1, tab);
  else tabs.push(tab);
  return { ...state, tabs, activeTabId: tab.tabId, open: true };
}

export function selectSidePanelTab(
  state: ThreadSidePanelTabs,
  tabId: string,
): ThreadSidePanelTabs {
  return state.tabs.some((tab) => tab.tabId === tabId)
    ? { ...state, activeTabId: tabId, open: true }
    : state;
}

export function closeSidePanelTab(
  state: ThreadSidePanelTabs,
  tabId: string,
): ThreadSidePanelTabs {
  const index = state.tabs.findIndex((tab) => tab.tabId === tabId);
  if (index < 0) return state;
  const tabs = state.tabs.filter((tab) => tab.tabId !== tabId);
  return {
    ...state,
    tabs,
    ...(state.previewTabId === tabId ? { previewTabId: null } : {}),
    activeTabId:
      state.activeTabId === tabId
        ? (tabs[Math.min(index, tabs.length - 1)]?.tabId ?? null)
        : state.activeTabId,
    open: state.open && tabs.length > 0,
  };
}
