import type { RefObject } from "react";
import * as AlertDialog from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";
import { SettingsAction } from "../../SettingsPrimitives";
import { pluginDisplayName } from "@/features/plugin/ui/PluginCatalogPageViewModel";
import type { MarketplaceSettingsController } from "./useMarketplaceSettings";

export function RemoveMarketplaceDialog({
  controller,
  trigger,
  refreshButton,
}: {
  controller: MarketplaceSettingsController;
  trigger: RefObject<HTMLButtonElement | null>;
  refreshButton: RefObject<HTMLButtonElement | null>;
}) {
  const { t } = useTranslation("settings");
  const { removal, pending, closeRemoval, prepareRemoval, remove } = controller;
  const marketplace = removal?.marketplace;
  return (
    <AlertDialog.Root
      open={removal !== null}
      onOpenChange={(open) => {
        if (!open) closeRemoval();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <AlertDialog.Content
          role="alertdialog"
          className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-32px)] w-[440px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-background p-5 text-foreground shadow-xl"
          onEscapeKeyDown={(event) => {
            if (pending) event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            (trigger.current?.isConnected
              ? trigger.current
              : refreshButton.current
            )?.focus();
          }}
        >
          <AlertDialog.Title className="text-[16px] font-medium">
            {t("settings.plugins.marketplace.removeTitle", {
              name:
                marketplace?.interface?.displayName || marketplace?.name || "",
            })}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-[13px] text-muted-foreground">
            {t(
              removal?.plugins?.length === 0
                ? "settings.plugins.marketplace.noInstalled"
                : "settings.plugins.marketplace.installedDescription",
            )}
          </AlertDialog.Description>
          {removal?.plugins === null && !removal.error ? (
            <p role="status" className="mt-3 text-[13px] text-muted-foreground">
              {t("settings.plugins.marketplace.loadingPlugins")}
            </p>
          ) : null}
          {removal?.plugins?.length ? (
            <ul className="mt-3 space-y-2 text-[13px]">
              {removal.plugins.map((plugin) => (
                <li
                  key={plugin.id}
                  className="flex min-w-0 items-center justify-between gap-3"
                >
                  <span className="min-w-0 break-words">
                    {pluginDisplayName(plugin)}
                  </span>
                  {removal.completed.includes(plugin.id) ? (
                    <span className="shrink-0 text-[12px] text-muted-foreground">
                      {t("settings.plugins.marketplace.uninstalled")}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {removal?.error ? (
            <p role="alert" className="mt-3 text-[13px] text-destructive">
              {t(`settings.plugins.marketplace.removeError.${removal.error}`)}
            </p>
          ) : null}
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Close asChild>
              <SettingsAction type="button" disabled={pending}>
                {t("settings.plugins.marketplace.cancel")}
              </SettingsAction>
            </AlertDialog.Close>
            <SettingsAction
              type="button"
              disabled={
                pending ||
                (removal?.plugins === null && removal?.error !== "load")
              }
              onClick={() => {
                if (removal?.error === "load" && marketplace)
                  void prepareRemoval(marketplace);
                else void remove();
              }}
            >
              {t(
                removal?.error
                  ? "settings.browser.retry"
                  : removal?.plugins?.length
                    ? "settings.plugins.marketplace.uninstallAndRemove"
                    : "settings.plugins.marketplace.remove",
              )}
            </SettingsAction>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
