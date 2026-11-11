import { Fragment, useState } from "react";
import { openExternalUrlWithSystemBrowser } from "@/lib/api/externalUrl";
import { Check, Folder, LoaderCircle, MoreHorizontal, Plus, ShieldCheck, Unplug, X } from "lucide-react";
import type {
  AppServerPluginDetail,
  AppServerPluginSummary,
} from "@/lib/api/appServerTypes";
import { PluginCatalogAppsSection } from "./PluginCatalogAppsSection";
import { PluginSkillsSection } from "./PluginSkillsSection";
import {
  detailCapabilityCount,
  pluginDisplayName,
  pluginDescription,
} from "./PluginCatalogPageViewModel";

export function PluginDetailPanel({
  summary,
  detail,
  t,
  onClose,
  onInstall,
  onToggle,
  onUninstall,
  busy,
}: {
  summary: AppServerPluginSummary | null;
  detail: AppServerPluginDetail | null;
  t: (key: string, options?: Record<string, unknown>) => string;
  onClose: () => void;
  onInstall?: () => void;
  onToggle?: () => void;
  onUninstall?: () => void;
  busy?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  if (!summary) {
    return (
      <aside className="hidden min-h-[300px] rounded-lg border border-dashed border-[color:var(--lime-surface-border)] px-5 py-6 text-sm text-[color:var(--lime-text-muted)] xl:block">
        {t("plugin.catalog.v2.detail.empty")}
      </aside>
    );
  }
  return (
    <aside
      className="min-w-0 max-w-[860px]"
      data-testid="plugin-catalog-detail"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-[color:var(--lime-text-muted)]">
            <button
              type="button"
              className="rounded hover:text-[color:var(--lime-text-strong)] hover:underline"
              onClick={onClose}
            >
              {t("plugin.catalog.v2.title")}
            </button>
            <span aria-hidden="true"> › </span>
            {pluginDisplayName(summary)}
          </p>
          <h2 className="mt-1 flex min-w-0 items-center gap-1.5 truncate text-lg font-semibold text-[color:var(--lime-text-strong)]">
            <span className="truncate">{pluginDisplayName(summary)}</span>
            <Folder
              className="h-4 w-4 shrink-0 text-[color:var(--lime-text-muted)]"
              aria-hidden="true"
            />
          </h2>
          <p className="mt-1 text-xs text-[color:var(--lime-text-muted)]">
            {t("plugin.catalog.v2.detail.byline", {
              developer:
                summary.interface?.developerName ||
                (summary.source.type === "local"
                  ? "Lime"
                  : t("plugin.catalog.v2.detail.unknownDeveloper")),
            })}
            {pluginDescription(summary)
              ? ` • ${pluginDescription(summary)}`
              : ""}
          </p>
        </div>
        {summary.installed ? (
          <div className="relative ml-auto shrink-0">
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[color:var(--lime-surface-border)] px-3 text-xs font-semibold text-[color:var(--lime-text)] hover:bg-[color:var(--lime-surface-hover)]"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={t("plugin.catalog.v2.moreActions")}
              data-testid={`plugin-catalog-actions-${summary.id}`}
              onClick={() => setMenuOpen((value) => !value)}
            >
              {t("plugin.catalog.v2.detail.manage")}
              <MoreHorizontal size={14} />
            </button>
            {menuOpen ? (
              <div
                className="absolute right-0 top-9 z-10 min-w-[150px] overflow-hidden rounded-lg border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] py-1 shadow-lg shadow-slate-950/10"
                role="menu"
              >
                <button
                  type="button"
                  className="flex h-9 w-full items-center gap-2 px-3 text-left text-sm font-medium hover:bg-[color:var(--lime-surface-hover)]"
                  role="menuitem"
                  disabled={busy}
                  data-testid={`plugin-catalog-toggle-${summary.id}`}
                  onClick={() => {
                    setMenuOpen(false);
                    onToggle?.();
                  }}
                >
                  {summary.enabled ? <Unplug size={15} /> : <Check size={15} />}
                  {summary.enabled
                    ? t("plugin.catalog.v2.disable")
                    : t("plugin.catalog.v2.enable")}
                </button>
                <button
                  type="button"
                  className="flex h-9 w-full items-center gap-2 px-3 text-left text-sm font-medium text-rose-700 hover:bg-rose-50"
                  role="menuitem"
                  disabled={busy}
                  data-testid={`plugin-catalog-uninstall-${summary.id}`}
                  onClick={() => {
                    setMenuOpen(false);
                    onUninstall?.();
                  }}
                >
                  <X size={15} />
                  {t("plugin.catalog.v2.uninstall")}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        {!summary.installed && onInstall ? (
          <button
            type="button"
            className="ml-auto inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-[color:var(--lime-text-strong)] px-3 text-xs font-semibold text-[color:var(--lime-surface)] hover:opacity-90"
            onClick={onInstall}
          >
            <Plus size={14} />
            {t("plugin.catalog.v2.detail.install")}
          </button>
        ) : null}
      </div>
      <p className="mt-4 text-sm leading-6 text-[color:var(--lime-text-muted)]">
        {detail?.description ||
          pluginDescription(summary) ||
          t("plugin.catalog.v2.descriptionFallback")}
      </p>
      {detail ? (
        <div className="mt-5 space-y-4 border-t border-[color:var(--lime-surface-border)] pt-4">
          <PluginSkillsSection detail={detail} t={t} />
          <CapabilityGroup
            title={t("plugin.catalog.v2.detail.mcp")}
            items={detail.mcpServers}
          />
          <PluginCatalogAppsSection capabilities={detail.apps} t={t} />
          <CapabilityGroup
            title={t("plugin.catalog.v2.detail.hooks")}
            items={detail.hooks.map((item) => item.eventName)}
          />
          <PluginInfoSection summary={summary} t={t} />
          <p className="flex items-center gap-2 text-xs text-[color:var(--lime-text-muted)]">
            <ShieldCheck size={14} className="text-emerald-700" />
            {t("plugin.catalog.v2.capabilityCount", {
              count: detailCapabilityCount(detail),
            })}
          </p>
        </div>
      ) : (
        <div className="mt-5 flex items-center text-sm text-[color:var(--lime-text-muted)]">
          <LoaderCircle size={15} className="mr-2 animate-spin" />
          {t("plugin.catalog.v2.detail.loading")}
        </div>
      )}
    </aside>
  );
}

function CapabilityGroup({ title, items }: { title: string; items: string[] }) {
  if (!items.length) {
    return null;
  }
  return (
    <div>
      <h3 className="text-xs font-semibold text-[color:var(--lime-text-strong)]">
        {title}
        <span className="ml-1.5 font-normal text-[color:var(--lime-text-muted)]">
          {items.length}
        </span>
      </h3>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span
            key={item}
            className="max-w-full truncate rounded-full border border-[color:var(--lime-surface-border)] px-2 py-1 text-xs text-[color:var(--lime-text-muted)]"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function PluginInfoSection({
  summary,
  t,
}: {
  summary: AppServerPluginSummary;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const info = summary.interface;
  const capabilities = info?.capabilities ?? [];
  const links: Array<{ key: string; label: string; url: string }> = [];
  if (info?.websiteUrl) {
    links.push({
      key: "website",
      label: t("plugin.catalog.v2.detail.website"),
      url: info.websiteUrl,
    });
  }
  if (info?.privacyPolicyUrl) {
    links.push({
      key: "privacy",
      label: t("plugin.catalog.v2.detail.privacy"),
      url: info.privacyPolicyUrl,
    });
  }
  if (info?.termsOfServiceUrl) {
    links.push({
      key: "terms",
      label: t("plugin.catalog.v2.detail.terms"),
      url: info.termsOfServiceUrl,
    });
  }
  return (
    <div>
      <h3 className="text-xs font-semibold text-[color:var(--lime-text-strong)]">
        {t("plugin.catalog.v2.detail.info")}
      </h3>
      <dl className="mt-2 grid grid-cols-[96px_minmax(0,1fr)] gap-y-1.5 text-xs">
        {capabilities.length ? (
          <>
            <dt className="text-[color:var(--lime-text-muted)]">
              {t("plugin.catalog.v2.detail.capabilities")}
            </dt>
            <dd className="text-[color:var(--lime-text-strong)]">
              {capabilities.join(", ")}
            </dd>
          </>
        ) : null}
        {info?.developerName ? (
          <>
            <dt className="text-[color:var(--lime-text-muted)]">
              {t("plugin.catalog.v2.detail.developer")}
            </dt>
            <dd className="text-[color:var(--lime-text-strong)]">
              {info.developerName}
            </dd>
          </>
        ) : null}
        {info?.category ? (
          <>
            <dt className="text-[color:var(--lime-text-muted)]">
              {t("plugin.catalog.v2.detail.category")}
            </dt>
            <dd className="text-[color:var(--lime-text-strong)]">
              {info.category}
            </dd>
          </>
        ) : null}
        <dt className="text-[color:var(--lime-text-muted)]">
          {t("plugin.catalog.v2.detail.version")}
        </dt>
        <dd className="text-[color:var(--lime-text-strong)]">
          {summary.version}
        </dd>
        {links.map((link) => (
          <Fragment key={link.key}>
            <dt className="text-[color:var(--lime-text-muted)]">{link.label}</dt>
            <dd>
              <button
                type="button"
                className="text-[color:var(--lime-text-strong)] underline-offset-4 hover:underline"
                onClick={() => {
                  void openExternalUrlWithSystemBrowser(link.url);
                }}
              >
                {link.url}
              </button>
            </dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}
