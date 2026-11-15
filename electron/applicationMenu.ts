import type { MenuItemConstructorOptions } from "electron";

export const APP_MENU_COMMAND_EVENT = "app-menu-command";

export type ApplicationMenuLocale =
  | "zh-CN"
  | "zh-TW"
  | "en-US"
  | "ja-JP"
  | "ko-KR";

const LABELS: Record<
  ApplicationMenuLocale,
  {
    about: string;
    settings: string;
    checkForUpdates: string;
    file: string;
    newTab: string;
    newWindow: string;
    newChat: string;
    newStandaloneChat: string;
    newProject: string;
    openFolder: string;
    help: string;
    systemStatus: string;
    taskManager: string;
    keyboardShortcuts: string;
    whatsNew: string;
    sendFeedback: string;
    temporaryChat: string;
    troubleshooting: string;
    close: string;
    documentation: string;
    openLogs: string;
  }
> = {
  "zh-CN": {
    about: "关于 Lime",
    settings: "设置…",
    checkForUpdates: "检查更新…",
    file: "文件",
    newTab: "新建标签页",
    newWindow: "新建窗口",
    newChat: "新聊天",
    newStandaloneChat: "新建独立聊天",
    newProject: "新建项目…",
    openFolder: "打开文件夹…",
    help: "帮助",
    systemStatus: "系统状态",
    taskManager: "任务管理器",
    keyboardShortcuts: "显示键盘快捷键",
    whatsNew: "新功能",
    temporaryChat: "新建临时聊天",
    sendFeedback: "发送反馈",
    troubleshooting: "故障排查",
    close: "关闭",
    documentation: "帮助文档",
    openLogs: "打开日志目录",
  },
  "zh-TW": {
    about: "關於 Lime",
    settings: "設定…",
    checkForUpdates: "檢查更新…",
    file: "檔案",
    newTab: "新增分頁",
    newWindow: "新增視窗",
    newChat: "新對話",
    newStandaloneChat: "新增獨立對話",
    newProject: "新增專案…",
    openFolder: "開啟資料夾…",
    help: "說明",
    systemStatus: "系統狀態",
    taskManager: "工作管理員",
    keyboardShortcuts: "顯示鍵盤快速鍵",
    whatsNew: "新功能",
    temporaryChat: "新增臨時對話",
    sendFeedback: "傳送意見回饋",
    troubleshooting: "疑難排解",
    close: "關閉",
    documentation: "說明文件",
    openLogs: "開啟日誌目錄",
  },
  "en-US": {
    about: "About Lime",
    settings: "Settings…",
    checkForUpdates: "Check for Updates…",
    file: "File",
    newTab: "New Tab",
    newWindow: "New Window",
    newChat: "New Chat",
    newStandaloneChat: "New standalone chat",
    newProject: "New Project…",
    openFolder: "Open Folder…",
    help: "Help",
    systemStatus: "System Status",
    taskManager: "Task Manager",
    keyboardShortcuts: "Show Keyboard Shortcuts",
    whatsNew: "What's New",
    temporaryChat: "New Temporary Chat",
    sendFeedback: "Send Feedback",
    troubleshooting: "Troubleshooting",
    close: "Close",
    documentation: "Documentation",
    openLogs: "Open Logs Folder",
  },
  "ja-JP": {
    about: "Lime について",
    settings: "設定…",
    checkForUpdates: "アップデートを確認…",
    file: "ファイル",
    newTab: "新しいタブ",
    newWindow: "新規ウインドウ",
    newChat: "新しいチャット",
    newStandaloneChat: "新しいスタンドアロンチャット",
    newProject: "新しいプロジェクト…",
    openFolder: "フォルダーを開く…",
    help: "ヘルプ",
    systemStatus: "システムの状態",
    taskManager: "タスクマネージャー",
    keyboardShortcuts: "キーボードショートカットを表示",
    whatsNew: "新機能",
    temporaryChat: "新しい一時チャット",
    sendFeedback: "フィードバックを送信",
    troubleshooting: "トラブルシューティング",
    close: "閉じる",
    documentation: "ドキュメント",
    openLogs: "ログフォルダを開く",
  },
  "ko-KR": {
    about: "Lime 정보",
    settings: "설정…",
    checkForUpdates: "업데이트 확인…",
    file: "파일",
    newTab: "새 탭",
    newWindow: "새 창",
    newChat: "새 채팅",
    newStandaloneChat: "새 독립 채팅",
    newProject: "새 프로젝트…",
    openFolder: "폴더 열기…",
    help: "도움말",
    systemStatus: "시스템 상태",
    taskManager: "작업 관리자",
    keyboardShortcuts: "키보드 단축키 표시",
    whatsNew: "새로운 기능",
    temporaryChat: "새 임시 채팅",
    sendFeedback: "피드백 보내기",
    troubleshooting: "문제 해결",
    close: "닫기",
    documentation: "문서",
    openLogs: "로그 폴더 열기",
  },
};

export function resolveApplicationMenuLocale(
  locale: string,
): ApplicationMenuLocale {
  const normalized = locale.toLowerCase();
  if (normalized.startsWith("zh")) {
    return /hant|tw|hk|mo/.test(normalized) ? "zh-TW" : "zh-CN";
  }
  if (normalized.startsWith("ja")) return "ja-JP";
  if (normalized.startsWith("ko")) return "ko-KR";
  return "en-US";
}

export function applicationMenuLabels(locale: string) {
  return LABELS[resolveApplicationMenuLocale(locale)];
}

export interface AppMetricEntry {
  type: string;
  pid: number;
  cpu: { percentCPUUsage: number };
  memory: { workingSetSize: number };
}

export function formatTaskManagerDetail(metrics: AppMetricEntry[]): string {
  const detail = metrics
    .map((metric) => {
      const cpu = metric.cpu.percentCPUUsage.toFixed(1);
      const memoryMb = (metric.memory.workingSetSize / 1024).toFixed(0);
      return `${metric.type}  pid=${metric.pid}  CPU ${cpu}%  MEM ${memoryMb} MB`;
    })
    .join("\n");
  return detail || "-";
}

export function buildApplicationMenuTemplate({
  appName,
  locale,
  onOpenAbout,
  onOpenSettings,
  onCheckForUpdates,
  onOpenDocumentation,
  onOpenLogs,
  onOpenSystemStatus,
  onOpenTaskManager,
  onOpenTroubleshooting,
  onShowKeyboardShortcuts,
  onOpenWhatsNew,
  onSendFeedback,
  onNewTab,
  onNewWindow,
  onNewChat,
  onNewTemporaryChat,
  onNewStandaloneChat,
  onNewProject,
  onOpenFolder,
  onCloseWindow,
  isMac,
}: {
  appName: string;
  locale: string;
  onOpenAbout: () => void;
  onOpenSettings: () => void;
  onCheckForUpdates: () => void;
  onOpenDocumentation: () => void;
  onOpenLogs: () => void;
  onOpenSystemStatus: () => void;
  onOpenTaskManager: () => void;
  onOpenTroubleshooting: () => void;
  onShowKeyboardShortcuts: () => void;
  onOpenWhatsNew: () => void;
  onSendFeedback: () => void;
  onNewTab: () => void;
  onNewWindow: () => void;
  onNewChat: () => void;
  onNewTemporaryChat: () => void;
  onNewStandaloneChat: () => void;
  onNewProject: () => void;
  onOpenFolder: () => void;
  onCloseWindow: () => void;
  isMac: boolean;
}): MenuItemConstructorOptions[] {
  const labels = applicationMenuLabels(locale);
  const applicationMenu: MenuItemConstructorOptions = {
    label: appName,
    submenu: [
      { label: labels.about, click: onOpenAbout },
      {
        label: labels.settings,
        accelerator: "CommandOrControl+,",
        click: onOpenSettings,
      },
      { label: labels.checkForUpdates, click: onCheckForUpdates },
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ],
  };
  const helpMenu: MenuItemConstructorOptions = {
    label: labels.help,
    role: "help",
    submenu: [
      { label: labels.documentation, click: onOpenDocumentation },
      {
        label: labels.keyboardShortcuts,
        click: onShowKeyboardShortcuts,
      },
      { label: labels.whatsNew, click: onOpenWhatsNew },
      { type: "separator" },
      { label: labels.troubleshooting, click: onOpenTroubleshooting },
      { label: labels.systemStatus, click: onOpenSystemStatus },
      { label: labels.sendFeedback, click: onSendFeedback },
      { type: "separator" },
      { label: labels.taskManager, click: onOpenTaskManager },
      { type: "separator" },
      { label: labels.openLogs, click: onOpenLogs },
    ],
  };
  const fileMenu: MenuItemConstructorOptions = {
    label: labels.file,
    submenu: [
      {
        label: labels.newTab,
        accelerator: "CommandOrControl+T",
        click: onNewTab,
      },
      {
        label: labels.newWindow,
        click: onNewWindow,
      },
      {
        label: labels.newChat,
        accelerator: "CommandOrControl+N",
        click: onNewChat,
      },
      {
        label: labels.temporaryChat,
        accelerator: "CommandOrControl+Shift+N",
        click: onNewTemporaryChat,
      },
      { label: labels.newProject, click: onNewProject },
      {
        label: labels.newStandaloneChat,
        accelerator: "CommandOrControl+Alt+O",
        click: onNewStandaloneChat,
      },
      { type: "separator" },
      {
        label: labels.openFolder,
        accelerator: "CommandOrControl+O",
        click: onOpenFolder,
      },
      { type: "separator" },
      {
        label: labels.close,
        accelerator: "CommandOrControl+W",
        click: onCloseWindow,
      },
    ],
  };
  if (isMac) {
    return [
      applicationMenu,
      fileMenu,
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
      helpMenu,
    ];
  }
  return [
    {
      label: labels.file,
      submenu: [
        {
          label: labels.newTab,
          accelerator: "CommandOrControl+T",
          click: onNewTab,
        },
        { label: labels.newWindow, click: onNewWindow },
        {
          label: labels.newChat,
          accelerator: "CommandOrControl+N",
          click: onNewChat,
        },
        {
          label: labels.temporaryChat,
          accelerator: "CommandOrControl+Shift+N",
          click: onNewTemporaryChat,
        },
        { label: labels.newProject, click: onNewProject },
        {
          label: labels.newStandaloneChat,
          accelerator: "CommandOrControl+Alt+O",
          click: onNewStandaloneChat,
        },
        { type: "separator" },
        {
          label: labels.openFolder,
          accelerator: "CommandOrControl+O",
          click: onOpenFolder,
        },
        { type: "separator" },
        {
          label: labels.close,
          accelerator: "CommandOrControl+W",
          click: onCloseWindow,
        },
        { type: "separator" },
        { label: labels.settings, click: onOpenSettings },
        { label: labels.checkForUpdates, click: onCheckForUpdates },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    helpMenu,
  ];
}
