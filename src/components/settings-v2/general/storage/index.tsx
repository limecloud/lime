import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SettingsSectionContext } from "../../sections";
import { SettingsTabs } from "@/types/settings";
import {
  SettingsAction,
  SettingsGroup,
  SettingsPageBody,
  SettingsPageHeader,
  SettingsRow,
} from "../../SettingsPrimitives";
import { ReviewChatsDialog } from "./ReviewChatsDialog";
import { StorageUsage } from "./StorageUsage";
import { useStorageSettings } from "./useStorageSettings";

export function DeviceStorageSettings({
  onNavigate,
}: Pick<SettingsSectionContext, "onNavigate">) {
  const { t } = useTranslation("settings");
  const { state, failed, pending, refresh } = useStorageSettings();
  const [reviewing, setReviewing] = useState(false);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const pageBody = useRef<HTMLDivElement>(null);
  const canReview =
    !failed &&
    !pending &&
    ["threads", "subagents", "archived"].every((category) =>
      state?.completedCategories.some((entry) => entry === category),
    );
  return (
    <SettingsPageBody
      ref={pageBody}
      tabIndex={-1}
      data-testid="settings-storage-page"
    >
      <SettingsPageHeader title={t("settings.storage.title")} />
      <section className="min-w-0 space-y-4">
        <header>
          <h2 className="text-[14px] font-medium">
            {t("settings.storage.thisDevice")}
          </h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {t("settings.storage.description")}
          </p>
        </header>
        <div className="flex flex-col gap-10">
          <StorageUsage
            state={state}
            failed={failed}
            pending={pending}
            onRefresh={() => void refresh()}
          />
          <SettingsGroup>
            <SettingsRow
              targetId="storage-cleanup"
              label={t("settings.storage.cleanup")}
              description={t("settings.storage.cleanupDescription")}
            >
              <SettingsAction
                ref={reviewButton}
                type="button"
                disabled={!canReview}
                onClick={() => setReviewing(true)}
              >
                {t("settings.storage.review")}
              </SettingsAction>
            </SettingsRow>
          </SettingsGroup>
        </div>
        <SettingsGroup>
          <SettingsRow
            targetId="storage-worktrees"
            label={t("settings.storage.worktrees")}
            description={t("settings.storage.worktreesDescription")}
          >
            <SettingsAction
              type="button"
              disabled={!onNavigate}
              onClick={() =>
                onNavigate?.("settings", { tab: SettingsTabs.Worktrees })
              }
            >
              {t("settings.storage.manage")}
            </SettingsAction>
          </SettingsRow>
          <SettingsRow
            targetId="storage-archived"
            label={t("settings.storage.archived")}
            description={t("settings.storage.archivedDescription")}
          >
            <SettingsAction
              type="button"
              disabled={!onNavigate}
              onClick={() =>
                onNavigate?.("settings", {
                  tab: SettingsTabs.ArchivedConversations,
                })
              }
            >
              {t("settings.storage.manage")}
            </SettingsAction>
          </SettingsRow>
        </SettingsGroup>
      </section>
      {reviewing ? (
        <ReviewChatsDialog
          onClose={() => setReviewing(false)}
          onDeleted={() => void refresh()}
          onRestoreFocus={() => {
            if (reviewButton.current && !reviewButton.current.disabled)
              reviewButton.current.focus();
            else pageBody.current?.focus();
          }}
        />
      ) : null}
    </SettingsPageBody>
  );
}
