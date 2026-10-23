import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  SettingsAction,
  SettingsGroup,
  SettingsPageBody,
  SettingsPageHeader,
  SettingsRow,
  SettingsSwitch,
} from "../../SettingsPrimitives";
import { useWorktreeSettings } from "./useWorktreeSettings";
import { WorktreeRoot } from "./WorktreeRoot";
import { ManagedWorktrees } from "./ManagedWorktrees";
import { WorktreeCleanup } from "./WorktreeCleanup";
import type { WorktreeNavigationProps } from "./useWorktreeNavigation";

export function WorktreesSettings({
  onNavigate,
}: WorktreeNavigationProps = {}) {
  const { t } = useTranslation("settings");
  const { preferences, error, saving, save, refresh } = useWorktreeSettings();
  return (
    <SettingsPageBody data-testid="settings-worktrees-page">
      <SettingsPageHeader title={t("settings.worktrees.title")} />
      {error ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 text-[13px] text-[color:var(--lime-danger)]"
        >
          {t("settings.worktrees.failed")}
          <SettingsAction onClick={() => void refresh()} disabled={saving}>
            {t("settings.worktrees.retry")}
          </SettingsAction>
        </div>
      ) : null}
      {preferences ? (
        <>
          <SettingsGroup>
            <WorktreeRoot
              saved={preferences.root}
              saving={saving}
              save={async (value) => {
                const saved = await save("root", value);
                if (saved) toast.success(t("settings.worktrees.rootSaved"));
                else toast.error(t("settings.worktrees.rootSaveFailed"));
                return saved;
              }}
            />
            <SettingsRow
              targetId="worktrees-upstream-refresh"
              label={t("settings.worktrees.upstreamRefresh")}
              description={t("settings.worktrees.upstreamRefreshDescription")}
            >
              <SettingsSwitch
                aria-labelledby="worktrees-upstream-refresh-label"
                aria-describedby="worktrees-upstream-refresh-description"
                checked={preferences["upstream-refresh-mode"] === "best-effort"}
                disabled={saving}
                onCheckedChange={async (value) => {
                  const saved = await save(
                    "upstream-refresh-mode",
                    value ? "best-effort" : "never",
                  );
                  if (!saved) toast.error(t("settings.worktrees.failed"));
                  else if (value)
                    toast.success(t("settings.worktrees.upstreamEnabled"));
                  else toast.success(t("settings.worktrees.upstreamDisabled"));
                }}
              />
            </SettingsRow>
            <WorktreeCleanup
              preferences={preferences}
              saving={saving}
              save={save}
            />
          </SettingsGroup>
          <ManagedWorktrees key={preferences.root} onNavigate={onNavigate} />
        </>
      ) : !error ? (
        <p role="status">{t("settings.worktrees.loading")}</p>
      ) : null}
    </SettingsPageBody>
  );
}
