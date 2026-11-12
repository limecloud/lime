import {
  Check,
  ExternalLink,
  Folder,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  Puzzle,
  Unplug,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  pluginDescription,
  pluginDisplayName,
  type PluginCatalogEntry,
} from "./PluginCatalogPageViewModel";

export function PluginCatalogCard({
  entry,
  isSelected,
  busyId,
  menuOpen,
  onSelect,
  onMenuToggle,
  onToggle,
  onUninstall,
  onInstall,
}: {
  entry: PluginCatalogEntry;
  isSelected: boolean;
  busyId: string | null;
  menuOpen: boolean;
  onSelect: () => void;
  onMenuToggle: () => void;
  onToggle: () => void;
  onUninstall: () => void;
  onInstall: () => void;
}) {
  const { t } = useTranslation("agent");
  const { plugin, marketplace } = entry;
  const busy = Boolean(busyId);
  const isBusy = busyId === plugin.id;
  const logoUrl =
    plugin.interface?.logoUrl ||
    plugin.interface?.composerIconUrl ||
    plugin.interface?.logo ||
    null;
  const marketplaceLabel =
    marketplace.interface?.displayName || marketplace.name;
  return (
    <article
      className={cn(
        "group flex min-w-0 items-start gap-3 rounded-lg px-2 py-3 transition-colors",
        isSelected
          ? "bg-[color:var(--lime-surface-hover)]"
          : "hover:bg-[color:var(--lime-surface-hover)]",
      )}
      data-testid={`plugin-catalog-card-${plugin.id}`}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)]">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt=""
            aria-hidden="true"
            className="h-6 w-6 object-contain"
          />
        ) : (
          <Puzzle
            size={18}
            className="text-[color:var(--lime-text-muted)]"
            aria-hidden="true"
          />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            className="min-w-0 truncate text-sm font-semibold text-[color:var(--lime-text-strong)]"
            onClick={() => onSelect()}
            data-testid={`plugin-catalog-select-${plugin.id}`}
          >
            {pluginDisplayName(plugin)}
          </button>
          {plugin.source.type === "local" ? (
            <Folder
              className="h-3.5 w-3.5 shrink-0 text-[color:var(--lime-text-muted)]"
              aria-hidden="true"
            />
          ) : null}
        </div>
        <p className="mt-0.5 line-clamp-2 text-[13px] leading-5 text-[color:var(--lime-text-muted)]">
          {pluginDescription(plugin) ||
            t("plugin.catalog.v2.descriptionFallback")}
        </p>

      </div>
      <div className="relative shrink-0">
        {plugin.installed ? (
          <>
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--lime-text-muted)] hover:bg-[color:var(--lime-surface)] hover:text-[color:var(--lime-text-strong)]"
              onClick={() => onMenuToggle()}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={t("plugin.catalog.v2.moreActions")}
              data-testid={`plugin-catalog-actions-${plugin.id}`}
            >
              <MoreHorizontal size={17} />
            </button>
            {menuOpen ? (
              <div
                className="absolute right-0 top-9 z-10 min-w-[150px] overflow-hidden rounded-lg border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] py-1 shadow-lg shadow-slate-950/10"
                role="menu"
              >
                <button
                  type="button"
                  className="flex h-9 w-full items-center gap-2 px-3 text-left text-sm font-medium hover:bg-[color:var(--lime-surface-hover)]"
                  onClick={() => onToggle()}
                  role="menuitem"
                  data-testid={`plugin-catalog-toggle-${plugin.id}`}
                >
                  {plugin.enabled ? <Unplug size={15} /> : <Check size={15} />}
                  {plugin.enabled
                    ? t("plugin.catalog.v2.disable")
                    : t("plugin.catalog.v2.enable")}
                </button>
                <button
                  type="button"
                  className="flex h-9 w-full items-center gap-2 px-3 text-left text-sm font-medium text-rose-700 hover:bg-rose-50"
                  onClick={() => {
                    onUninstall();
                  }}
                  role="menuitem"
                  data-testid={`plugin-catalog-uninstall-${plugin.id}`}
                >
                  <X size={15} />
                  {t("plugin.catalog.v2.uninstall")}
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[color:var(--lime-text-strong)] text-[color:var(--lime-surface)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => {
              onInstall();
            }}
            disabled={
              busy ||
              plugin.installPolicy === "NOT_AVAILABLE" ||
              plugin.availability === "DISABLED_BY_ADMIN"
            }
            aria-label={t("plugin.catalog.v2.install")}
            title={t("plugin.catalog.v2.install")}
            data-testid={`plugin-catalog-install-${plugin.id}`}
          >
            {isBusy ? (
              <LoaderCircle size={15} className="animate-spin" />
            ) : (
              <Plus size={16} />
            )}
          </button>
        )}
      </div>
    </article>
  );
}
