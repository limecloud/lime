import { describe, expect, it } from "vitest";
import { getLimeI18n } from "@/i18n/createI18n";
import { SettingsTabs } from "@/types/settings";
import { settingsSections } from "./sections";
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
const search = (query: string, localProfile = true) => {
  const { t, groups } = localize();
  return searchSettings(query, groups, t, localProfile);
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
    "%s finds Configuration defaults and routes conditional network search to its sandbox parent",
    (locale) => {
      const { t, groups } = localize(locale);
      expect(
        searchSettings(
          t("settings.configuration.modelFeatures.label"),
          groups,
          t,
          true,
        ),
      ).toContainEqual(
        expect.objectContaining({
          section: SettingsTabs.Configuration,
          targetId: "configuration-scope",
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
            true,
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
          searchSettings(t(`settings.worktrees.${message}`), groups, t, true),
        ).toContainEqual(
          expect.objectContaining({
            section: SettingsTabs.Worktrees,
            targetId,
          }),
        );
      }
      expect(
        searchSettings("/private/fixture-worktrees", groups, t, true),
      ).toEqual([]);
    },
  );
  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "%s finds the current dictation sounds control",
    (locale) => {
      const { t, groups } = localize(locale);
      expect(
        searchSettings(t("settings.voice.sounds.label"), groups, t, true),
      ).toContainEqual(
        expect.objectContaining({
          section: SettingsTabs.Voice,
          targetId: "voice-sounds",
        }),
      );
    },
  );
  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "%s finds dictation dictionary without indexing user entries",
    (locale) => {
      const { t, groups } = localize(locale);
      expect(
        searchSettings(t("settings.voice.dictionary.label"), groups, t, true),
      ).toContainEqual(
        expect.objectContaining({
          section: SettingsTabs.Voice,
          targetId: "voice-dictionary",
        }),
      );
      expect(
        searchSettings("private-dictionary-fixture-entry", groups, t, true),
      ).toEqual([]);
    },
  );
  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "%s finds the microphone field without indexing device names",
    (locale) => {
      const { t, groups } = localize(locale);
      expect(
        searchSettings(t("settings.voice.microphone.label"), groups, t, true),
      ).toContainEqual(
        expect.objectContaining({
          section: SettingsTabs.Voice,
          targetId: "voice-microphone",
        }),
      );
      expect(searchSettings("fixture-usb", groups, t, true)).toEqual([]);
    },
  );
  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "%s resolves the ten independent Media expectations",
    (locale) => {
      const { t, groups } = localize(locale);
      for (const [section, targetId, message] of mediaTargets) {
        expect(
          searchSettings(t(`settings.${message}`), groups, t, true),
        ).toContainEqual(expect.objectContaining({ section, targetId }));
        expect(
          searchSettings(
            t(
              `settings.${message.replace(/\.(title|label)$/, ".description")}`,
            ),
            groups,
            t,
            true,
          ),
        ).toContainEqual(expect.objectContaining({ section, targetId }));
        expect(getSettingsSearchDocument(section, targetId, true)?.path).toBe(
          undefined,
        );
      }
    },
  );
  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "%s resolves current static targets with existing messages",
    (locale) => {
      const { t, groups } = localize(locale);
      for (const document of settingsSearchDocuments) {
        expect(t(document.labelKey)).not.toBe(document.labelKey);
        for (const key of document.termKeys) expect(t(key)).not.toBe(key);
        expect(
          searchSettings(t(document.labelKey), groups, t, true),
        ).toContainEqual(
          expect.objectContaining({
            section: document.section,
            targetId: document.targetId,
          }),
        );
      }
    },
  );
  it("matches descriptions and multiple words from the same target and panel", () => {
    const { t } = localize();
    const description = t("settings.environment.overrides.description");
    expect(search(description)).toContainEqual(
      expect.objectContaining({ targetId: "environment-overrides" }),
    );
    expect(search("profile bio")).toContainEqual(
      expect.objectContaining({ targetId: "profile-bio" }),
    );
    expect(search("display bio")).toEqual([]);
    expect(search("   ")).toEqual([]);
  });
  it("normalizes width and case, prioritizes panel titles and returns one result per panel", () => {
    const results = search("ＰＲＯＦＩＬＥ");
    expect(results[0]).toMatchObject({ section: SettingsTabs.Profile });
    expect(results[0].targetId).toBeUndefined();
    const broad = search("a");
    expect(new Set(broad.map((result) => result.section)).size).toBe(
      broad.length,
    );
  });
  it("derives titles from all current sections, with no extra section registry", () => {
    const { t, groups } = localize();
    for (const section of settingsSections) {
      expect(
        searchSettings(t(section.labelKey), groups, t, false),
      ).toContainEqual({
        section: section.key,
        label: t(section.labelKey),
        panelLabel: t(section.labelKey),
      });
    }
    expect(search("fixture private profile value")).toEqual([]);
  });
  it("excludes local fields in managed account mode but preserves the Profile title", () => {
    expect(search("bio", false)).toEqual([]);
    expect(search("profile", false)).toContainEqual(
      expect.objectContaining({ section: SettingsTabs.Profile }),
    );
    expect(
      isSettingsSearchTarget(SettingsTabs.Profile, "profile-bio", false),
    ).toBe(false);
  });
  it("rejects unknown, cross-section and selector-shaped targets", () => {
    expect(
      isSettingsSearchTarget(SettingsTabs.Profile, "profile-bio", true),
    ).toBe(true);
    for (const target of [
      "missing",
      "environment-overrides",
      'profile-bio"] input, *',
    ]) {
      expect(isSettingsSearchTarget(SettingsTabs.Profile, target, true)).toBe(
        false,
      );
    }
  });
});
