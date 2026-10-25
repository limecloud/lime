import { useTranslation } from "react-i18next";
import type { Page, PageParams } from "@/types/page";
import {
  SettingsAction,
  SettingsGroup,
  SettingsRow,
  SettingsSwitch,
} from "../../SettingsPrimitives";
import type { SkillsSettingsController } from "./useSkillsSettings";
import { matchesQuery } from "./plugins-page-selectors";

export function InstalledSkillsSettings({
  controller,
  onNavigate,
  searchQuery = "",
}: {
  controller: SkillsSettingsController;
  onNavigate?: (page: Page, params?: PageParams) => void;
  searchQuery?: string;
}) {
  const { t } = useTranslation("settings");
  const { skills, loading, pending, error, reload, mutate } = controller;
  const visibleSkills = skills.filter((skill) =>
    matchesQuery(searchQuery, [
      skill.name,
      skill.interface?.displayName,
      skill.interface?.shortDescription,
      skill.shortDescription,
      skill.description,
    ]),
  );
  return (
    <div
      id="plugins-skills"
      data-settings-target="plugins-skills"
      className="min-w-0 space-y-4"
      data-testid="plugins-installed-skills"
    >
      {error ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 text-[13px] text-destructive"
        >
          <span>{t(`settings.plugins.skills.error.${error}`)}</span>
          <SettingsAction
            type="button"
            disabled={loading || pending}
            onClick={() => void reload()}
          >
            {t("settings.browser.retry")}
          </SettingsAction>
        </div>
      ) : null}
      {loading && skills.length === 0 ? (
        <p role="status" className="text-[13px] text-muted-foreground">
          {t("settings.plugins.skills.loading")}
        </p>
      ) : skills.length === 0 ? (
        error ? null : (
          <p className="text-[13px] text-muted-foreground">
            {t("settings.plugins.skills.empty")}
          </p>
        )
      ) : visibleSkills.length === 0 ? (
        <p role="status" className="text-[13px] text-muted-foreground">
          {t("settings.plugins.search.empty")}
        </p>
      ) : (
        <SettingsGroup>
          {visibleSkills.map((skill) => {
            const name = skill.interface?.displayName || skill.name;
            return (
              <SettingsRow
                key={skill.path}
                data-skill-path={skill.path}
                label={
                  onNavigate ? (
                    <button
                      type="button"
                      className="max-w-full text-left [overflow-wrap:anywhere] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                      onClick={() =>
                        onNavigate("skills", {
                          initialSearchQuery: skill.name,
                          initialView: "installed",
                        })
                      }
                    >
                      {name}
                    </button>
                  ) : (
                    name
                  )
                }
                description={
                  skill.interface?.shortDescription ||
                  skill.shortDescription ||
                  skill.description ||
                  undefined
                }
              >
                <SettingsSwitch
                  checked={skill.enabled}
                  disabled={loading || pending || error === "refresh"}
                  aria-label={t("settings.plugins.enabled", { name })}
                  onCheckedChange={(enabled) =>
                    void mutate(skill.path, enabled)
                  }
                />
              </SettingsRow>
            );
          })}
        </SettingsGroup>
      )}
    </div>
  );
}
