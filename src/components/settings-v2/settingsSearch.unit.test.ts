import { describe, expect, it } from "vitest";
import { getLimeI18n } from "@/i18n/createI18n";
import { SettingsTabs } from "@/types/settings";
import { isSettingsSection, settingsSections } from "./sections";
import type { CategoryGroup } from "./hooks/useSettingsCategory";
import {
  searchSettings,
  isSettingsSearchTarget,
  getSettingsSearchDocument,
} from "./settingsSearch";
import { settingsSearchDocuments } from "./settingsSearchDocuments";

const localize = (locale = "en-US") => {
  const t = getLimeI18n().getFixedT(locale, "settings");
  const groups: CategoryGroup[] = [];
  for (const section of settingsSections) {
    if (!isSettingsSection(section.key)) continue;
    let group = groups.find((value) => value.key === section.group);
    if (!group) {
      group = {
        key: section.group,
        title: section.group ? t(`settings.group.${section.group}`) : "",
        items: [],
      };
      groups.push(group);
    }
    group.items.push({
      key: section.key,
      label: t(section.labelKey),
      icon: section.icon,
    });
  }
  return { t, groups };
};
const search = (query: string) => {
  const { t, groups } = localize();
  return searchSettings(query, groups, t);
};

// 独立列出 current 可见字段，避免从被测索引生成自己的期望。
const mediaTargets = [
  [
    SettingsTabs.MediaServices,
    "media-service-responsive-chat",
    "mediaServices.sections.responsiveChat.title",
  ],
  [
    SettingsTabs.MediaServices,
    "media-service-topic",
    "mediaServices.sections.topic.title",
  ],
  [
    SettingsTabs.MediaServices,
    "media-service-generation-topic",
    "mediaServices.sections.generationTopic.title",
  ],
  [
    SettingsTabs.MediaServices,
    "media-service-translation",
    "mediaServices.sections.translation.title",
  ],
  [
    SettingsTabs.MediaServices,
    "media-service-history-compress",
    "mediaServices.sections.historyCompress.title",
  ],
  [
    SettingsTabs.MediaServices,
    "media-service-agent-meta",
    "mediaServices.sections.agentMeta.title",
  ],
  [
    SettingsTabs.MediaServices,
    "media-service-input-completion",
    "mediaServices.sections.inputCompletion.title",
  ],
  [
    SettingsTabs.MediaServices,
    "media-service-prompt-rewrite",
    "mediaServices.sections.promptRewrite.title",
  ],
  [
    SettingsTabs.MediaServices,
    "media-service-resource-prompt-rewrite",
    "mediaServices.sections.resourcePromptRewrite.title",
  ],
  [
    SettingsTabs.MediaServices,
    "media-image-count",
    "mediaServices.imageSettings.count.label",
  ],
] as const;

describe("current settings search projection", () => {
  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "%s close confirmation is localized and searchable on every platform",
    (locale) => {
      const { t, groups } = localize(locale);
      for (const key of [
        "label",
        "shortcutDescription",
        "description",
        "never",
        "keyboardOnly",
        "always",
      ]) {
        const message = `settings.general.confirmBeforeClose.${key}`;
        expect(t(message)).not.toBe(message);
        for (const platform of ["mac", "windows", "other"] as const) {
          expect(
            searchSettings(t(message), groups, t, platform),
          ).toContainEqual(
            expect.objectContaining({
              section: SettingsTabs.General,
              targetId: "general-confirm-before-close",
            }),
          );
        }
      }
    },
  );
  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "%s 带网站限定词的权限搜索定位现有网站设置入口",
    (locale) => {
      const { t, groups } = localize(locale);
      for (const permission of [
        "camera",
        "microphone",
        "geolocation",
        "notifications",
      ]) {
        const query = t(`browserSiteSettings.${permission}`);
        expect(query).not.toBe(`browserSiteSettings.${permission}`);
        expect(
          searchSettings(
            `${t("browserSiteSettings.title")} ${query}`,
            groups,
            t,
          ),
        ).toContainEqual(
          expect.objectContaining({
            section: SettingsTabs.Browser,
            targetId: "browser-site-settings",
          }),
        );
      }
    },
  );
  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "%s 防休眠搜索只定位非Windows的可见设置",
    (locale) => {
      const { t, groups } = localize(locale);
      const query = t("settings.desktop.preventSleepWhileRunning");
      for (const platform of ["mac", "other"] as const) {
        expect(searchSettings(query, groups, t, platform)).toContainEqual(
          expect.objectContaining({
            section: SettingsTabs.General,
            targetId: "general-prevent-sleep",
          }),
        );
        expect(
          isSettingsSearchTarget(
            SettingsTabs.General,
            "general-prevent-sleep",
            platform,
          ),
        ).toBe(true);
      }
      expect(searchSettings(query, groups, t, "windows")).toEqual([]);
      expect(
        isSettingsSearchTarget(
          SettingsTabs.General,
          "general-prevent-sleep",
          "windows",
        ),
      ).toBe(false);
    },
  );
  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "%s 菜单栏搜索只定位 macOS 的可见设置",
    (locale) => {
      const { t, groups } = localize(locale);
      const query = t("settings.desktop.macMenuBar");
      expect(query).toContain("Lime");
      expect(searchSettings(query, groups, t, "mac")).toContainEqual(
        expect.objectContaining({
          section: SettingsTabs.General,
          targetId: "general-menu-bar",
        }),
      );
      for (const platform of ["windows", "other"] as const) {
        expect(searchSettings(query, groups, t, platform)).toEqual([]);
        expect(
          isSettingsSearchTarget(
            SettingsTabs.General,
            "general-menu-bar",
            platform,
          ),
        ).toBe(false);
        expect(
          getSettingsSearchDocument(
            SettingsTabs.General,
            "general-menu-bar",
            platform,
          ),
        ).toBeUndefined();
      }
    },
  );
  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "%s routes Auto detect language to the searchable language picker",
    (locale) => {
      const { t, groups } = localize(locale);
      expect(
        searchSettings(t("settings.desktop.autoDetectLanguage"), groups, t),
      ).toContainEqual(
        expect.objectContaining({
          section: SettingsTabs.General,
          targetId: "general-language",
        }),
      );
    },
  );
  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "%s finds the Enter behavior control and its multiline choice",
    (locale) => {
      const { t, groups } = localize(locale);
      for (const key of ["enterBehavior", "cmdIfMultiline"]) {
        const message = t(`settings.desktop.${key}`);
        expect(message).not.toBe(`settings.desktop.${key}`);
        expect(searchSettings(message, groups, t)).toContainEqual(
          expect.objectContaining({
            section: SettingsTabs.General,
            targetId: "general-enter-behavior",
          }),
        );
      }
    },
  );
  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "%s finds Configuration defaults and routes conditional network search to its sandbox parent",
    (locale) => {
      const { t, groups } = localize(locale);
      expect(
        searchSettings(
          t("settings.configuration.modelFeatures.label"),
          groups,
          t,
        ),
      ).toContainEqual(
        expect.objectContaining({
          section: SettingsTabs.General,
          targetId: "general-reasoning-efforts",
        }),
      );
      for (const field of [
        "approval_policy",
        "sandbox_mode",
        "model_verbosity",
        "model_reasoning_summary",
        "network",
      ]) {
        expect(
          searchSettings(
            t(`settings.configuration.fields.${field}.label`),
            groups,
            t,
          ),
        ).toContainEqual(
          expect.objectContaining({
            section: SettingsTabs.Configuration,
            targetId: `configuration-${field === "network" ? "sandbox_mode" : field}`,
          }),
        );
      }
    },
  );
  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "%s finds worktree preferences without indexing a private directory",
    (locale) => {
      const { t, groups } = localize(locale);
      for (const [message, targetId] of [
        ["root", "worktrees-root"],
        ["upstreamRefresh", "worktrees-upstream-refresh"],
        ["managed", "worktrees-managed"],
      ]) {
        expect(
          searchSettings(t(`settings.worktrees.${message}`), groups, t),
        ).toContainEqual(
          expect.objectContaining({
            section: SettingsTabs.Worktrees,
            targetId,
          }),
        );
      }
      expect(searchSettings("/private/fixture-worktrees", groups, t)).toEqual(
        [],
      );
    },
  );
  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "%s finds the current dictation sounds control",
    (locale) => {
      const { t, groups } = localize(locale);
      expect(
        searchSettings(t("settings.voice.sounds.label"), groups, t),
      ).toContainEqual(
        expect.objectContaining({
          section: SettingsTabs.Voice,
          targetId: "voice-sounds",
        }),
      );
    },
  );
  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "%s finds the realtime voice chat section",
    (locale) => {
      const { t, groups } = localize(locale);
      expect(
        searchSettings(t("settings.voice.chat.label"), groups, t),
      ).toContainEqual(
        expect.objectContaining({
          section: SettingsTabs.Voice,
          targetId: "voice-chat",
        }),
      );
    },
  );
  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "%s finds realtime model and voice settings",
    (locale) => {
      const { t, groups } = localize(locale);
      for (const query of [
        t("settings.voice.chat.model.label"),
        t("settings.voice.chat.voice.label"),
      ]) {
        expect(searchSettings(query, groups, t)).toContainEqual(
          expect.objectContaining({
            section: SettingsTabs.Voice,
            targetId: "voice-chat",
          }),
        );
      }
    },
  );
  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "%s finds dictation dictionary without indexing user entries",
    (locale) => {
      const { t, groups } = localize(locale);
      expect(
        searchSettings(t("settings.voice.dictionary.label"), groups, t),
      ).toContainEqual(
        expect.objectContaining({
          section: SettingsTabs.Voice,
          targetId: "voice-dictionary",
        }),
      );
      expect(
        searchSettings("private-dictionary-fixture-entry", groups, t),
      ).toEqual([]);
    },
  );
  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "%s finds the microphone field without indexing device names",
    (locale) => {
      const { t, groups } = localize(locale);
      expect(
        searchSettings(t("settings.voice.microphone.label"), groups, t),
      ).toContainEqual(
        expect.objectContaining({
          section: SettingsTabs.Voice,
          targetId: "voice-microphone",
        }),
      );
      expect(searchSettings("fixture-usb", groups, t)).toEqual([]);
    },
  );
  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "%s resolves the ten independent Media expectations",
    (locale) => {
      const { t, groups } = localize(locale);
      for (const [section, targetId, message] of mediaTargets) {
        expect(
          searchSettings(t(`settings.${message}`), groups, t),
        ).toContainEqual(expect.objectContaining({ section, targetId }));
        expect(
          searchSettings(
            t(
              `settings.${message.replace(/\.(title|label)$/, ".description")}`,
            ),
            groups,
            t,
          ),
        ).toContainEqual(expect.objectContaining({ section, targetId }));
        expect(getSettingsSearchDocument(section, targetId)?.path).toBe(
          undefined,
        );
      }
    },
  );
  describe.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "%s current static search targets",
    (locale) => {
      it.each(settingsSearchDocuments)(
        "$targetId resolves with existing messages",
        (document) => {
          const { t, groups } = localize(locale);
          expect(t(document.labelKey)).not.toBe(document.labelKey);
          for (const key of document.termKeys) expect(t(key)).not.toBe(key);
          expect(
            searchSettings(t(document.labelKey), groups, t, document.platform),
          ).toContainEqual(
            expect.objectContaining({
              section: document.section,
              targetId: document.targetId,
            }),
          );
        },
      );
    },
  );
  it("matches descriptions and multiple words from the same target and panel", () => {
    const { t } = localize();
    const description = t("settings.localEnvironments.description");
    expect(search(description)).toContainEqual(
      expect.objectContaining({ targetId: "local-environments-projects" }),
    );
    expect(search("personalization instructions")).toContainEqual(
      expect.objectContaining({ targetId: "memory-instructions" }),
    );
    expect(search("display instructions")).toEqual([]);
    expect(search("   ")).toEqual([]);
  });
  it("finds Codex theme presets by their extracted names", () => {
    expect(search("ChatGPT")).toContainEqual(
      expect.objectContaining({
        section: SettingsTabs.Appearance,
        targetId: "appearance-code-theme",
      }),
    );
    expect(search("Light chrome theme")).toContainEqual(
      expect.objectContaining({
        section: SettingsTabs.Appearance,
        targetId: "appearance-chrome-theme",
      }),
    );
    expect(search("code theme")).toContainEqual(
      expect.objectContaining({
        section: SettingsTabs.Appearance,
        targetId: "appearance-code-theme",
      }),
    );
  });
  it("normalizes width and case, prioritizes panel titles and returns one result per panel", () => {
    const results = search("ＡＰＰＥＡＲＡＮＣＥ");
    expect(results[0]).toMatchObject({ section: SettingsTabs.Appearance });
    expect(results[0].targetId).toBeUndefined();
    const broad = search("a");
    expect(new Set(broad.map((result) => result.section)).size).toBe(
      broad.length,
    );
  });
  it("derives titles from all current sections, with no extra section registry", () => {
    const { t, groups } = localize();
    for (const section of settingsSections) {
      if (!isSettingsSection(section.key)) continue;
      expect(searchSettings(t(section.labelKey), groups, t)).toContainEqual({
        section: section.key,
        label: t(section.labelKey),
        panelLabel: t(section.labelKey),
      });
    }
    expect(search("fixture private profile value")).toEqual([]);
  });
  it("does not offer retired local profile fields", () => {
    expect(search("bio")).toEqual([]);
    expect(isSettingsSearchTarget(SettingsTabs.Profile, "profile-bio")).toBe(
      false,
    );
  });
  it("rejects unknown, cross-section and selector-shaped targets", () => {
    expect(
      isSettingsSearchTarget(SettingsTabs.Memory, "memory-instructions"),
    ).toBe(true);
    for (const target of [
      "missing",
      "local-environments-projects",
      'profile-bio"] input, *',
    ]) {
      expect(isSettingsSearchTarget(SettingsTabs.Profile, target)).toBe(false);
    }
  });
});

it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
  "%s resolves MCP fields to the MCP settings page",
  (locale) => {
    const { t, groups } = localize(locale);
    for (const key of ["addServer", "authenticate", "envVars"]) {
      expect(
        searchSettings(t("settings.plugins.mcp." + key), groups, t),
      ).toContainEqual(
        expect.objectContaining({
          section: SettingsTabs.McpServers,
          targetId: "mcp-servers",
        }),
      );
    }
    expect(isSettingsSearchTarget(SettingsTabs.McpServers, "mcp-servers")).toBe(
      true,
    );
    expect(searchSettings("fixture-secret-mcp-token", groups, t)).toEqual([]);
  },
);

it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
  "%s finds application connections target",
  (locale) => {
    const { t, groups } = localize(locale);
    expect(
      searchSettings(t("settings.connections.external.title"), groups, t),
    ).toContainEqual(
      expect.objectContaining({
        section: SettingsTabs.Connections,
        targetId: "connections-grants",
      }),
    );
    expect(
      isSettingsSearchTarget(SettingsTabs.Connections, "connections-grants"),
    ).toBe(true);
  },
);
