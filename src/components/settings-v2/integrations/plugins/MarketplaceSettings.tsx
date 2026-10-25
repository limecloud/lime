import { useRef, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import {
  SettingsAction,
  SettingsGroup,
  SettingsRow,
} from "../../SettingsPrimitives";
import { RemoveMarketplaceDialog } from "./RemoveMarketplaceDialog";
import {
  marketplaceKey,
  type MarketplaceSettingsController,
} from "./useMarketplaceSettings";
import { matchesQuery } from "./plugins-page-selectors";

export function MarketplaceSettings({
  controller,
  refreshButton,
  searchQuery = "",
}: {
  controller: MarketplaceSettingsController;
  refreshButton: RefObject<HTMLButtonElement | null>;
  searchQuery?: string;
}) {
  const { t } = useTranslation("settings");
  const trigger = useRef<HTMLButtonElement | null>(null);
  const {
    marketplaces,
    loading,
    pending,
    error,
    retry,
    canRemove,
    canUpgrade,
    prepareRemoval,
    upgrade,
    removal,
  } = controller;
  const visibleMarketplaces = marketplaces.filter((marketplace) =>
    matchesQuery(searchQuery, [
      marketplace.name,
      marketplace.interface?.displayName,
      marketplace.path,
    ]),
  );
  return (
    <div
      id="plugins-marketplace"
      data-settings-target="plugins-marketplace"
      data-testid="plugins-marketplace"
      className="min-w-0 space-y-4"
    >
      {error ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 text-[13px] text-destructive"
        >
          <span>{t(`settings.plugins.marketplace.error.${error}`)}</span>
          <SettingsAction
            type="button"
            disabled={loading || pending}
            onClick={() => void retry()}
          >
            {t("settings.browser.retry")}
          </SettingsAction>
        </div>
      ) : null}
      {loading && marketplaces.length === 0 ? (
        <p role="status" className="text-[13px] text-muted-foreground">
          {t("settings.plugins.marketplace.loading")}
        </p>
      ) : marketplaces.length === 0 ? (
        error ? null : (
          <p className="text-[13px] text-muted-foreground">
            {t("settings.plugins.marketplace.empty")}
          </p>
        )
      ) : visibleMarketplaces.length === 0 ? (
        <p role="status" className="text-[13px] text-muted-foreground">
          {t("settings.plugins.search.empty")}
        </p>
      ) : (
        <SettingsGroup>
          {visibleMarketplaces.map((marketplace) => {
            const name = marketplace.interface?.displayName || marketplace.name;
            return (
              <SettingsRow
                key={marketplaceKey(marketplace)}
                data-marketplace-key={marketplaceKey(marketplace)}
                label={name}
                description={
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span>
                      {t("settings.plugins.marketplace.pluginCount", {
                        count: marketplace.plugins.length,
                      })}
                    </span>
                    {marketplace.path ? (
                      <span className="break-all">{marketplace.path}</span>
                    ) : null}
                  </span>
                }
              >
                <SettingsAction
                  type="button"
                  disabled={
                    loading ||
                    pending ||
                    Boolean(removal) ||
                    !canUpgrade(marketplace)
                  }
                  title={
                    !canUpgrade(marketplace)
                      ? t("settings.plugins.marketplace.gitOnly")
                      : undefined
                  }
                  aria-label={t("settings.plugins.marketplace.upgradeNamed", {
                    name,
                  })}
                  onClick={() => void upgrade(marketplace)}
                >
                  {t("settings.plugins.marketplace.upgrade")}
                </SettingsAction>
                <SettingsAction
                  type="button"
                  disabled={
                    loading ||
                    pending ||
                    Boolean(removal) ||
                    !canRemove(marketplace)
                  }
                  title={
                    !canRemove(marketplace)
                      ? t("settings.plugins.marketplace.configuredOnly")
                      : undefined
                  }
                  aria-label={t("settings.plugins.marketplace.removeNamed", {
                    name,
                  })}
                  onClick={(event) => {
                    trigger.current = event.currentTarget;
                    void prepareRemoval(marketplace);
                  }}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </SettingsAction>
              </SettingsRow>
            );
          })}
        </SettingsGroup>
      )}
      <RemoveMarketplaceDialog
        controller={controller}
        trigger={trigger}
        refreshButton={refreshButton}
      />
    </div>
  );
}
