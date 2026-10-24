export const APP_SIDEBAR_COLLAPSED_STORAGE_KEY = "lime.app-sidebar.collapsed";
export const APP_SIDEBAR_COLLAPSE_EVENT = "lime:app-sidebar-collapse";
export const APP_SIDEBAR_WIDTH = 340;
export const APP_SIDEBAR_MIN_WIDTH = 290;
export const APP_SIDEBAR_MAX_WIDTH = 520;
export const SIDEBAR_WIDTH_STORAGE_KEY = "sidebar-width";

export const SIDEBAR_RECENT_SESSION_PAGE_SIZE = 10;
export const SIDEBAR_SEARCH_RESULT_LIMIT = 8;
export const SIDEBAR_SESSION_ENTRY_REFRESH_DEFER_MS = 30_000;
export const SIDEBAR_SESSION_LOAD_RESTART_DEFER_MS = 160;
export const SIDEBAR_NEW_TASK_HOME_SESSION_LOAD_DEFER_MS = 0;
export const SIDEBAR_CONVERSATION_NAVIGATION_DEFER_MS =
  SIDEBAR_SESSION_ENTRY_REFRESH_DEFER_MS;

export const SIDEBAR_NAV_LABEL_KEYS: Record<string, string> = {
  "scheduled-tasks": "navigation.sidebar.items.scheduledTasks",
  channels: "navigation.sidebar.items.channels",
  "new-chat": "navigation.sidebar.items.newChat",
  plugins: "navigation.sidebar.items.plugins",
  settings: "navigation.sidebar.items.settings",
};
