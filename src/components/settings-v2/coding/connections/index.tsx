import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  listConnectionGrants,
  type ConnectionGrant,
} from "@/lib/api/connections";
import { formatDate } from "@/i18n/format";
import {
  SettingsAction,
  SettingsEmptyState,
  SettingsGroup,
  SettingsPageBody,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
} from "../../SettingsPrimitives";

export function ConnectionsSettings() {
  const { t } = useTranslation("settings");
  const [grants, setGrants] = useState<ConnectionGrant[] | null>(null);
  const [grantsError, setGrantsError] = useState(false);

  const loadGrants = async () => {
    setGrantsError(false);
    try {
      setGrants(await listConnectionGrants());
    } catch {
      setGrantsError(true);
    }
  };

  useEffect(() => {
    void loadGrants();
  }, []);

  return (
    <SettingsPageBody>
      <SettingsPageHeader title={t("settings.connections.title")} />
      <SettingsSection
        data-settings-search-target="connections-grants"
        tabIndex={-1}
        title={t("settings.connections.external.title")}
      >
        <p className="mb-3 text-xs text-muted-foreground">
          {t("settings.connections.external.description")}
        </p>
        {grants === null && !grantsError ? (
          <div
            role="status"
            aria-busy="true"
            data-testid="settings-connections-grants-loading"
            className="px-4 py-6 text-center text-xs text-muted-foreground"
          >
            {t("settings.connections.external.loading")}
          </div>
        ) : grantsError ? (
          <div
            role="alert"
            data-testid="settings-connections-grants-error"
            className="flex items-center gap-3 px-4 py-6 text-[12px] text-destructive"
          >
            {t("settings.connections.external.loadFailed")}
            <SettingsAction type="button" onClick={() => void loadGrants()}>
              {t("settings.connections.external.retry")}
            </SettingsAction>
          </div>
        ) : grants && grants.length > 0 ? (
          <SettingsGroup>
            {grants.map((grant) => (
              <SettingsRow
                key={grant.id}
                targetId={`connection-grant-${grant.id}`}
                label={grant.applicationName?.trim() || grant.applicationId}
                description={
                  <>
                    {t("settings.connections.external.fileCount", {
                      count: grant.fileCount,
                    })}
                    {" · "}
                    {t("settings.connections.external.expires", {
                      date: formatDate(grant.expiresAt, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }),
                    })}
                  </>
                }
              >
                <span className="text-[12px] text-muted-foreground">
                  {t("settings.connections.external.statusActive")}
                </span>
              </SettingsRow>
            ))}
          </SettingsGroup>
        ) : (
          <SettingsEmptyState data-testid="settings-connections-grants-empty">
            {t("settings.connections.external.empty")}
          </SettingsEmptyState>
        )}
      </SettingsSection>
    </SettingsPageBody>
  );
}
