import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_GIT_PREFERENCES } from "@/lib/api/gitPreferences";
import {
  SettingsAction,
  SettingsGroup,
  SettingsPageBody,
  SettingsPageHeader,
  SettingsRow,
  SettingsSwitch,
  SettingsValueMenu,
} from "../../SettingsPrimitives";
import { GitTextField } from "./GitTextField";
import { useGitSettings } from "./useGitSettings";

export function GitSettings() {
  const { t } = useTranslation("settings");
  const { preferences, error, pending, refresh, save } = useGitSettings();
  const savePrefix = useCallback(
    (value: string) => save("branch-prefix", value),
    [save],
  );
  const saveCommit = useCallback(
    (value: string) => save("commit-instructions", value),
    [save],
  );
  const savePr = useCallback(
    (value: string) => save("pull-request-instructions", value),
    [save],
  );
  return (
    <SettingsPageBody data-testid="settings-git-page">
      <SettingsPageHeader title={t("settings.git.title")} />
      {error ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 text-[13px] text-[color:var(--lime-danger)]"
        >
          <span>
            {t(
              error === "load"
                ? "settings.git.loadFailed"
                : "settings.git.saveFailed",
            )}
          </span>
          <SettingsAction
            type="button"
            disabled={pending}
            onClick={() => void refresh()}
          >
            {t("settings.git.retry")}
          </SettingsAction>
        </div>
      ) : null}
      {!preferences ? (
        <p role="status">{t("settings.git.loading")}</p>
      ) : (
        <>
          <SettingsGroup>
            <GitTextField
              targetId="git-branch-prefix"
              label={t("settings.git.branchPrefix")}
              description={t("settings.git.branchPrefixDescription")}
              placeholder={DEFAULT_GIT_PREFERENCES["branch-prefix"]}
              savedValue={preferences["branch-prefix"]}
              save={savePrefix}
            />
            {(["forcePush", "draftPr"] as const).map((field) => {
              const key =
                field === "forcePush"
                  ? "always-force-push"
                  : "create-draft-pull-requests";
              const target = `git-${field}`;
              return (
                <SettingsRow
                  key={key}
                  targetId={target}
                  label={t(`settings.git.${field}`)}
                  description={t(`settings.git.${field}Description`)}
                >
                  <SettingsSwitch
                    aria-labelledby={`${target}-label`}
                    aria-describedby={`${target}-description`}
                    checked={preferences[key]}
                    disabled={pending}
                    onCheckedChange={(value) =>
                      void save(key, value).catch(() => {})
                    }
                  />
                </SettingsRow>
              );
            })}
            <SettingsRow
              targetId="git-merge-method"
              label={t("settings.git.mergeMethod")}
              description={t("settings.git.mergeMethodDescription")}
            >
              <SettingsValueMenu
                targetId="git-merge-method"
                described
                value={preferences["pull-request-merge-method"]}
                disabled={pending}
                options={[
                  { value: "merge", label: t("settings.git.merge") },
                  { value: "squash", label: t("settings.git.squash") },
                ]}
                onChange={(value) =>
                  void save("pull-request-merge-method", value).catch(() => {})
                }
              />
            </SettingsRow>
            <SettingsRow
              targetId="git-review-delivery"
              label={t("settings.git.reviewDelivery")}
              description={t("settings.git.reviewDeliveryDescription")}
            >
              <SettingsValueMenu
                targetId="git-review-delivery"
                described
                value={preferences["review-delivery"]}
                disabled={pending}
                options={[
                  { value: "inline", label: t("settings.git.inline") },
                  { value: "detached", label: t("settings.git.detached") },
                ]}
                onChange={(value) =>
                  void save("review-delivery", value).catch(() => {})
                }
              />
            </SettingsRow>
          </SettingsGroup>
          <GitTextField
            targetId="git-commit-instructions"
            label={t("settings.git.commitInstructions")}
            description={t("settings.git.commitInstructionsDescription")}
            placeholder={t("settings.git.commitPlaceholder")}
            savedValue={preferences["commit-instructions"]}
            save={saveCommit}
            multiline
          />
          <GitTextField
            targetId="git-pr-instructions"
            label={t("settings.git.prInstructions")}
            description={t("settings.git.prInstructionsDescription")}
            placeholder={t("settings.git.prPlaceholder")}
            savedValue={preferences["pull-request-instructions"]}
            save={savePr}
            multiline
          />
        </>
      )}
    </SettingsPageBody>
  );
}
