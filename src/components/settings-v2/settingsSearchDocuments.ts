import { SettingsTabs } from "@/types/settings";

interface SettingsSearchDocument {
  section: SettingsTabs;
  targetId: string;
  labelKey: string;
  termKeys: readonly string[];
  localProfile?: boolean;
  path?: string;
}

// 只登记 current 页面上的静态消息；不索引用户资料、配置值或凭证。
export const settingsSearchDocuments: readonly SettingsSearchDocument[] = [
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
    termKeys: [`settings.desktop.${description}`],
  })),
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
    section: SettingsTabs.Profile,
    targetId: "profile-displayName",
    labelKey: "settings.profile.field.displayName.label",
    termKeys: ["settings.profile.field.displayName.placeholder"],
    localProfile: true,
  },
  {
    section: SettingsTabs.Profile,
    targetId: "profile-bio",
    labelKey: "settings.profile.field.bio.label",
    termKeys: ["settings.profile.field.bio.placeholder"],
    localProfile: true,
  },
  ...(["enable", "timeout"] as const).map((field) => ({
    section: SettingsTabs.Environment,
    targetId: `environment-shell-${field}`,
    labelKey: `settings.environment.shellImport.${field}.label`,
    termKeys: [`settings.environment.shellImport.${field}.tip`],
  })),
  {
    section: SettingsTabs.Environment,
    targetId: "environment-overrides",
    labelKey: "settings.environment.overrides.title",
    termKeys: ["settings.environment.overrides.description"],
  },
  ...(["workspace", "plan", "shell", "network"] as const).map((field) => ({
    section: SettingsTabs.ExecutionPolicy,
    targetId: `execution-policy-${field}`,
    labelKey: `settings.executionPolicy.${field}.title`,
    termKeys: [`settings.executionPolicy.${field}.description`],
  })),
  ...(
    [
      ["search", "engine", "searchChain.engine", true],
      ["search", "provider", "searchChain.provider", false],
      ["search", "provider-priority", "searchChain.providerPriority", true],
      ["providers", "tavily-key", "providers.tavily", true],
      ["providers", "bing-key", "providers.bing", true],
      ["providers", "google-key", "providers.googleApi", true],
      ["providers", "google-engine-id", "providers.googleEngine", true],
      ["mse", "mse-priority", "mse.priority", false],
      ["mse", "mse-max-per-engine", "mse.maxPerEngine", false],
      ["mse", "mse-max-total", "mse.maxTotal", false],
      ["mse", "mse-timeout", "mse.timeout", false],
      ["mse", "mse-custom-engine-name", "mse.customName", false],
      ["mse", "mse-custom-engine-template", "mse.customTemplate", false],
      ["images", "pexels-key", "images.pexels", true],
      ["images", "pixabay-key", "images.pixabay", true],
    ] as const
  ).map(([path, field, message, hasHint]) => ({
    section: SettingsTabs.WebSearch,
    targetId: `web-search-${field}`,
    path,
    labelKey: `settings.webSearch.${message}.label`,
    termKeys: hasHint ? [`settings.webSearch.${message}.hint`] : [],
  })),
  ...(["enabled", "tools", "delete", "instructions"] as const).map((field) => ({
    section: SettingsTabs.Memory,
    targetId: `memory-${field}`,
    labelKey: `settings.personalization.${field}`,
    termKeys: [
      `settings.personalization.${field === "instructions" ? "instructionsDescription" : "memoryDescription"}`,
    ],
  })),
  ...(
    [
      ["theme", "theme"],
      ["skin", "colorScheme"],
    ] as const
  ).map(([field, message]) => ({
    section: SettingsTabs.Appearance,
    targetId: `appearance-${field}`,
    labelKey: `settings.appearance.${message}.title`,
    termKeys: field === "theme" ? ["settings.desktop.mode"] : [],
  })),
  {
    section: SettingsTabs.Developer,
    targetId: "experimental-crash-reporting",
    path: "experimental",
    labelKey: "settings.experimental.crashReporting.title",
    termKeys: [
      "settings.experimental.crashReporting.description",
      "settings.experimental.crashReporting.dsn.label",
      "settings.experimental.crashReporting.environment.label",
      "settings.experimental.crashReporting.sampleRate.label",
      "settings.experimental.crashReporting.sendPii.title",
      "settings.experimental.crashReporting.sendPii.description",
    ],
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
