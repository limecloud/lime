import { SettingsTabs } from "@/types/settings";
import type { HotkeyPlatform } from "@/lib/hotkeys/platform";

interface SettingsSearchDocument {
  section: SettingsTabs;
  targetId: string;
  labelKey: string;
  termKeys: readonly string[];
  path?: string;
  platform?: HotkeyPlatform;
  excludePlatform?: HotkeyPlatform;
}

// 只登记 current 页面上的静态消息；不索引用户资料、配置值或凭证。
export const settingsSearchDocuments: readonly SettingsSearchDocument[] = [
  {
    section: SettingsTabs.General,
    targetId: "general-confirm-before-close",
    labelKey: "settings.general.confirmBeforeClose.label",
    termKeys: [
      "settings.general.confirmBeforeClose.shortcutDescription",
      "settings.general.confirmBeforeClose.description",
      "settings.general.confirmBeforeClose.never",
      "settings.general.confirmBeforeClose.keyboardOnly",
      "settings.general.confirmBeforeClose.always",
    ],
  },
  {
    section: SettingsTabs.General,
    targetId: "general-prevent-sleep",
    labelKey: "settings.desktop.preventSleepWhileRunning",
    termKeys: ["settings.desktop.preventSleepWhileRunningDescription"],
    excludePlatform: "windows",
  },
  {
    section: SettingsTabs.Plugins,
    targetId: "plugins-marketplace",
    labelKey: "settings.plugins.marketplace.title",
    termKeys: [
      "settings.plugins.marketplace.upgrade",
      "settings.plugins.marketplace.remove",
    ],
  },
  {
    section: SettingsTabs.Plugins,
    targetId: "plugins-skills",
    labelKey: "settings.plugins.skills.title",
    termKeys: ["settings.plugins.skills.title"],
  },
  {
    section: SettingsTabs.Plugins,
    targetId: "plugins-mcps",
    labelKey: "settings.plugins.mcp.servers",
    termKeys: [
      "settings.plugins.mcp.addServer",
      "settings.plugins.mcp.authenticate",
      "settings.plugins.mcp.titleNew",
      "settings.plugins.mcp.envVars",
    ],
  },
  {
    section: SettingsTabs.Plugins,
    targetId: "plugins-installed",
    labelKey: "settings.plugins.subtitle",
    termKeys: ["settings.plugins.subtitle", "settings.plugins.browseDirectory"],
  },
  {
    section: SettingsTabs.ComputerUse,
    targetId: "computer-use-native",
    labelKey: "settings.computerUse.anyApp",
    termKeys: [
      "settings.computerUse.description",
      "settings.computerUse.anyAppDescription",
    ],
  },
  {
    section: SettingsTabs.ComputerUse,
    targetId: "computer-use-chrome",
    labelKey: "settings.computerUse.chrome",
    termKeys: ["settings.computerUse.chromeDescription"],
  },
  {
    section: SettingsTabs.ComputerUse,
    targetId: "computer-use-office",
    labelKey: "settings.computerUse.wps",
    termKeys: ["settings.computerUse.wpsDescription"],
  },
  {
    section: SettingsTabs.ComputerUse,
    targetId: "computer-use-allowed-apps",
    labelKey: "settings.computerUse.allowedApps",
    termKeys: ["settings.computerUse.removeTitle"],
  },
  {
    section: SettingsTabs.Hooks,
    targetId: "hooks-sources",
    labelKey: "settings.hooks.description",
    termKeys: [
      "settings.hooks.description",
      "settings.hooks.trust",
      "settings.hooks.trustAll",
      "settings.hooks.matcher",
      "settings.hooks.group.plugins",
    ],
  },
  {
    section: SettingsTabs.Browser,
    targetId: "browser-site-settings",
    labelKey: "browserSiteSettings.title",
    termKeys: [
      "browserSiteSettings.description",
      "browserSiteSettings.camera",
      "browserSiteSettings.microphone",
      "browserSiteSettings.geolocation",
      "browserSiteSettings.notifications",
    ],
  },
  {
    section: SettingsTabs.Browser,
    targetId: "browser-browsing-data",
    labelKey: "browserData.settingLabel",
    termKeys: [
      "browserData.settingDescription",
      "browserData.type.siteData",
      "browserData.type.cache",
      "browserData.title",
    ],
  },
  ...(
    [
      ["usage", "dataDirectory", "description"],
      ["cleanup", "cleanup", "cleanupDescription"],
      ["worktrees", "worktrees", "worktreesDescription"],
      ["archived", "archived", "archivedDescription"],
    ] as const
  ).map(([target, label, description]) => ({
    section: SettingsTabs.Storage,
    targetId: `storage-${target}`,
    labelKey: `settings.storage.${label}`,
    termKeys: [`settings.storage.${description}`],
  })),
  {
    section: SettingsTabs.Worktrees,
    targetId: "worktrees-managed",
    labelKey: "settings.worktrees.managed",
    termKeys: ["settings.worktrees.conversations", "settings.worktrees.delete"],
  },
  ...(
    [
      ["root", "root"],
      ["upstream-refresh", "upstreamRefresh"],
      ["auto-cleanup", "autoCleanup"],
      ["keep-count", "keepCount"],
    ] as const
  ).map(([target, message]) => ({
    section: SettingsTabs.Worktrees,
    targetId: `worktrees-${target}`,
    labelKey: `settings.worktrees.${message}`,
    termKeys: [`settings.worktrees.${message}Description`],
  })),
  ...(
    [
      ["branch-prefix", "branchPrefix"],
      ["forcePush", "forcePush"],
      ["draftPr", "draftPr"],
      ["merge-method", "mergeMethod"],
      ["review-delivery", "reviewDelivery"],
      ["commit-instructions", "commitInstructions"],
      ["pr-instructions", "prInstructions"],
    ] as const
  ).map(([target, message]) => ({
    section: SettingsTabs.Git,
    targetId: `git-${target}`,
    labelKey: `settings.git.${message}`,
    termKeys: [`settings.git.${message}Description`],
  })),
  {
    section: SettingsTabs.Voice,
    targetId: "voice-history",
    labelKey: "settings.voice.history.label",
    termKeys: ["settings.voice.history.description"],
  },
  {
    section: SettingsTabs.Voice,
    targetId: "voice-sounds",
    labelKey: "settings.voice.sounds.label",
    termKeys: ["settings.voice.sounds.description"],
  },
  {
    section: SettingsTabs.Voice,
    targetId: "voice-dictionary",
    labelKey: "settings.voice.dictionary.label",
    termKeys: ["settings.voice.dictionary.description"],
  },
  {
    section: SettingsTabs.Voice,
    targetId: "voice-microphone",
    labelKey: "settings.voice.microphone.label",
    termKeys: ["settings.voice.microphone.description"],
  },
  ...(
    [
      ["file-target", "defaultFileTarget", "defaultFileTargetDescription"],
      ["language", "language", "languageDescription"],
      ["plugins", "plugins", "pluginsDescription"],
    ] as const
  ).map(([field, label, description]) => ({
    section: SettingsTabs.General,
    targetId: `general-${field}`,
    labelKey: `settings.desktop.${label}`,
    termKeys: [
      `settings.desktop.${description}`,
      ...(field === "language"
        ? [
            "settings.desktop.autoDetectLanguage",
            "settings.desktop.searchLanguages",
          ]
        : []),
    ],
  })),
  {
    section: SettingsTabs.General,
    targetId: "general-menu-bar",
    labelKey: "settings.desktop.macMenuBar",
    termKeys: ["settings.desktop.macMenuBarDescription"],
    platform: "mac",
  },
  {
    section: SettingsTabs.General,
    targetId: "general-enter-behavior",
    labelKey: "settings.desktop.enterBehavior",
    termKeys: [
      "settings.desktop.enterBehaviorDescription",
      "settings.desktop.enter",
      "settings.desktop.cmdIfMultiline",
      "settings.desktop.cmdAlways",
    ],
  },
  ...(
    [
      ["enabled", "enabledDescription"],
      ["full-url", "showFullUrl"],
      ["annotation-screenshot", "annotationScreenshot"],
      ["download-directory", "downloadDirectory"],
      ["ask-download", "askDownloadLocation"],
      ["history-access", "historyAccess"],
      ["site-tools", "siteTools"],
      ["agent-permissions", "agentPermissions"],
      ["full-cdp", "fullCdp"],
    ] as const
  ).map(([target, label]) => ({
    section: SettingsTabs.Browser,
    targetId: `browser-${target}`,
    labelKey: `settings.browser.${label}`,
    termKeys: [],
  })),
  {
    section: SettingsTabs.Browser,
    targetId: "browser-web-target",
    labelKey: "settings.browser.web",
    termKeys: ["settings.browser.inApp", "settings.browser.external"],
  },
  {
    section: SettingsTabs.Browser,
    targetId: "browser-local-target",
    labelKey: "settings.browser.local",
    termKeys: ["settings.browser.localDescription"],
  },
  {
    section: SettingsTabs.KeyboardShortcuts,
    targetId: "keyboard-external-browser-link",
    labelKey: "settings.keyboardShortcuts.externalLink",
    termKeys: ["settings.keyboardShortcuts.externalLinkDescription"],
  },
  {
    section: SettingsTabs.LocalEnvironments,
    targetId: "local-environments-projects",
    labelKey: "settings.localEnvironments.projects",
    termKeys: [
      "settings.localEnvironments.description",
      "settings.localEnvironments.setup",
      "settings.localEnvironments.cleanup",
      "settings.localEnvironments.actions",
    ],
  },
  ...(
    [
      "approval_policy",
      "sandbox_mode",
      "web_search",
      "model_verbosity",
      "model_reasoning_summary",
    ] as const
  ).map((field) => ({
    section: SettingsTabs.Configuration,
    targetId: `configuration-${field}`,
    labelKey: `settings.configuration.fields.${field}.label`,
    termKeys: [
      `settings.configuration.fields.${field}.description`,
      ...(field === "sandbox_mode"
        ? [
            "settings.configuration.fields.network.label",
            "settings.configuration.fields.network.description",
          ]
        : []),
    ],
  })),
  {
    section: SettingsTabs.Configuration,
    targetId: "configuration-scope",
    labelKey: "settings.configuration.modelFeatures.label",
    termKeys: [
      "settings.configuration.modelFeatures.title",
      "settings.configuration.modelFeatures.description",
    ],
  },
  ...(["plan", "shell", "network"] as const).map((field) => ({
    section: SettingsTabs.ExecutionPolicy,
    targetId: `execution-policy-${field}`,
    labelKey: `settings.executionPolicy.${field}.title`,
    termKeys: [`settings.executionPolicy.${field}.description`],
  })),
  ...(["enabled", "tools", "delete", "instructions"] as const).map((field) => ({
    section: SettingsTabs.Memory,
    targetId: `memory-${field}`,
    labelKey: `settings.personalization.${field}`,
    termKeys: [
      `settings.personalization.${field === "instructions" ? "instructionsDescription" : "memoryDescription"}`,
    ],
  })),
  {
    section: SettingsTabs.Appearance,
    targetId: "appearance-theme",
    labelKey: "settings.appearance.theme.title",
    termKeys: ["settings.desktop.mode"],
  },
  ...(
    [
      ["responsive-chat", "responsiveChat"],
      ["topic", "topic"],
      ["generation-topic", "generationTopic"],
      ["translation", "translation"],
      ["history-compress", "historyCompress"],
      ["agent-meta", "agentMeta"],
      ["input-completion", "inputCompletion"],
      ["prompt-rewrite", "promptRewrite"],
      ["resource-prompt-rewrite", "resourcePromptRewrite"],
    ] as const
  ).map(([field, message]) => ({
    section: SettingsTabs.MediaServices,
    targetId: `media-service-${field}`,
    labelKey: `settings.mediaServices.sections.${message}.title`,
    termKeys: [
      `settings.mediaServices.sections.${message}.description`,
      `settings.mediaServices.sections.${message}.modelHint`,
    ],
  })),
  {
    section: SettingsTabs.MediaServices,
    targetId: "media-image-count",
    labelKey: "settings.mediaServices.imageSettings.count.label",
    termKeys: ["settings.mediaServices.imageSettings.count.description"],
  },
];
