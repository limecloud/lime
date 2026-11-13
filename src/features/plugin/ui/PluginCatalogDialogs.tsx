import { LoaderCircle, PackageCheck, ShieldCheck, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AppServerPluginSummary } from "@/lib/api/appServerTypes";
import {
  pluginDisplayName,
  pluginDescription,
  type PluginCatalogEntry,
} from "./PluginCatalogPageViewModel";

export function PluginCatalogDialogs({
  installTarget,
  uninstallTarget,
  busyId,
  onInstall,
  onUninstall,
  onCancelInstall,
  onCancelUninstall,
}: {
  installTarget: PluginCatalogEntry | null;
  uninstallTarget: AppServerPluginSummary | null;
  busyId: string | null;
  onInstall: () => void;
  onUninstall: () => void;
  onCancelInstall: () => void;
  onCancelUninstall: () => void;
}) {
  const { t } = useTranslation("agent");
  return (
    <>
      {installTarget ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-[color:var(--lime-surface-muted)]/80 px-4"
          role="presentation"
        >
          <div
            className="w-full max-w-[520px] rounded-xl border-[0.5px] border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] p-5 "
            role="dialog"
            aria-modal="true"
            aria-labelledby="plugin-catalog-install-title"
            data-testid="plugin-catalog-install-review"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2
                  id="plugin-catalog-install-title"
                  className="mt-1 text-base font-semibold text-[color:var(--lime-text-strong)]"
                >
                  {t("plugin.catalog.v2.review.title")}
                </h2>
              </div>
              <button
                type="button"
                className="rounded-full p-1.5 text-[color:var(--lime-text-muted)] hover:bg-[color:var(--lime-surface-hover)]"
                onClick={() => onCancelInstall()}
                aria-label={t("plugin.catalog.v2.close")}
              >
                <X size={17} />
              </button>
            </div>
            {installTarget ? (
              <div className="mt-4 border-t-[0.5px] border-[color:var(--lime-surface-border)] pt-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold text-[color:var(--lime-text-strong)]">
                      {pluginDisplayName(installTarget.plugin)}
                    </h3>
                    <p className="mt-1 text-xs text-[color:var(--lime-text-muted)]">
                      {installTarget.plugin.id}{" "}
                      {t("plugin.catalog.v2.version", {
                        version: installTarget.plugin.version,
                      })}
                    </p>
                  </div>
                  <ShieldCheck
                    size={19}
                    className="shrink-0 text-[color:var(--lime-success)]"
                  />
                </div>
                <p className="mt-3 text-sm leading-6 text-[color:var(--lime-text-muted)]">
                  {pluginDescription(installTarget.plugin) ||
                    t("plugin.catalog.v2.descriptionFallback")}
                </p>
                <p className="mt-3 truncate text-xs text-[color:var(--lime-text-muted)]">
                  {t("plugin.catalog.v2.review.source", {
                    name:
                      installTarget.marketplace.interface?.displayName ||
                      installTarget.marketplace.name,
                  })}
                </p>
              </div>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="h-9 rounded-full border-[0.5px] border-[color:var(--lime-surface-border)] px-4 text-sm font-semibold text-[color:var(--lime-text-strong)] hover:bg-[color:var(--lime-surface-hover)]"
                onClick={() => onCancelInstall()}
              >
                {t("plugin.catalog.v2.cancel")}
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center gap-2 rounded-full bg-[color:var(--lime-text-strong)] px-5 text-sm font-semibold text-[color:var(--lime-surface)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => onInstall()}
                disabled={!installTarget || Boolean(busyId)}
                data-testid="plugin-catalog-confirm-install"
              >
                {busyId ? (
                  <LoaderCircle size={15} className="animate-spin" />
                ) : (
                  <PackageCheck size={15} />
                )}
                {t("plugin.catalog.v2.confirmInstall")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {uninstallTarget ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-[color:var(--lime-surface-muted)]/80 px-4"
          role="presentation"
        >
          <div
            className="w-full max-w-[420px] rounded-xl border-[0.5px] border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] p-5 "
            role="dialog"
            aria-modal="true"
            data-testid="plugin-catalog-uninstall-confirm"
          >
            <h2 className="text-base font-semibold text-[color:var(--lime-text-strong)]">
              {t("plugin.catalog.v2.uninstallTitle", {
                name: pluginDisplayName(uninstallTarget),
              })}
            </h2>
            <p className="mt-2 text-sm leading-6 text-[color:var(--lime-text-muted)]">
              {t("plugin.catalog.v2.uninstallDescription")}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="h-9 rounded-full border-[0.5px] border-[color:var(--lime-surface-border)] px-4 text-sm font-semibold text-[color:var(--lime-text-strong)] hover:bg-[color:var(--lime-surface-hover)]"
                onClick={() => onCancelUninstall()}
              >
                {t("plugin.catalog.v2.cancel")}
              </button>
              <button
                type="button"
                className="h-9 rounded-full bg-rose-700 px-4 text-sm font-semibold text-white hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => onUninstall()}
                disabled={Boolean(busyId)}
              >
                {t("plugin.catalog.v2.confirmUninstall")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
