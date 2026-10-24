import { useState } from "react";
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  BROWSER_PERMISSION_ACTIONS,
  DEFAULT_BROWSER_SITE_PERMISSIONS,
  normalizeBrowserSitePattern,
  type BrowserPermissions,
  type BrowserSettings,
} from "@/lib/api/browserSettings";
import { BROWSER_SETTINGS_BUTTON } from "./BrowserSettingsFields";
import { BrowserSitePermissionSelect } from "./BrowserSitePermissionSelect";
import {
  browserPermissionRowManaged,
  type BrowserPermissionContext,
} from "@/lib/api/browserUsePolicySitePermissions";

export function BrowserAgentPermissions({
  settings,
  context,
  disabled,
  onChange,
}: {
  settings: BrowserSettings;
  context: BrowserPermissionContext | null;
  disabled: boolean;
  onChange: (
    next: BrowserSettings["agent_permissions"],
    expected: BrowserSettings["agent_permissions"],
  ) => Promise<boolean>;
}) {
  const { t } = useTranslation("settings");
  const value = settings.agent_permissions;
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const [editingPattern, setEditingPattern] = useState<string | null>(null);
  const [pattern, setPattern] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [baseline, setBaseline] = useState<
    BrowserSettings["agent_permissions"] | null
  >(null);
  const actions = BROWSER_PERMISSION_ACTIONS.slice(page * 2, page * 2 + 2);
  const userPatterns = new Set(
    context?.userPermissions.sites.map((site) => site.pattern),
  );
  const sites = [...value.sites].sort(
    (a, b) =>
      Number(userPatterns.has(b.pattern)) -
        Number(userPatterns.has(a.pattern)) ||
      a.pattern.localeCompare(b.pattern),
  );
  const add = async () => {
    if (
      disabled ||
      (editingPattern !== null &&
        browserPermissionRowManaged(settings, context, editingPattern))
    )
      return;
    const expected = baseline ?? value;
    if (
      editingPattern !== null &&
      !expected.sites.some((site) => site.pattern === editingPattern)
    ) {
      setRemoved(true);
      return;
    }
    const normalized = normalizeBrowserSitePattern(pattern);
    if (
      !normalized ||
      expected.sites.some(
        (site) =>
          site.pattern !== editingPattern &&
          normalizeBrowserSitePattern(site.pattern) === normalized,
      )
    ) {
      setInvalid(true);
      return;
    }
    const sites =
      editingPattern === null
        ? [
            ...expected.sites,
            {
              pattern: normalized,
              permissions: { ...DEFAULT_BROWSER_SITE_PERMISSIONS },
            },
          ]
        : expected.sites.map((site) =>
            site.pattern === editingPattern
              ? { ...site, pattern: normalized }
              : site,
          );
    if (await onChange({ ...expected, sites }, expected)) {
      setAdding(false);
      setEditingPattern(null);
      setPattern("");
      setInvalid(false);
      setBaseline(null);
    } else {
      // 保留输入；下一次显式提交以已回读的当前矩阵为基准。
      setBaseline(null);
    }
  };
  return (
    <section
      id="browser-agent-permissions"
      aria-labelledby="browser-agent-permissions-label"
      data-settings-search-target="browser-agent-permissions"
      tabIndex={-1}
      className="space-y-2"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2
            id="browser-agent-permissions-label"
            className="text-sm font-medium"
          >
            {t("settings.browser.agentPermissions")}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("settings.browser.agentPermissionsDescription")}
          </p>
        </div>
        <button
          type="button"
          className={`${BROWSER_SETTINGS_BUTTON} flex items-center gap-1`}
          disabled={disabled}
          onClick={() => {
            setAdding(true);
            setEditingPattern(null);
            setPattern("");
            setInvalid(false);
            setRemoved(false);
            setBaseline(value);
          }}
        >
          <Plus className="size-3" aria-hidden="true" />
          {t("settings.browser.add")}
        </button>
      </div>
      {adding ? (
        <form
          className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <label className="sr-only" htmlFor="browser-site-pattern">
            {t("settings.browser.sitePattern")}
          </label>
          <input
            id="browser-site-pattern"
            autoFocus
            value={pattern}
            disabled={disabled}
            aria-invalid={invalid || removed}
            aria-describedby={
              invalid
                ? "browser-site-pattern-error"
                : removed
                  ? "browser-site-rule-removed"
                  : undefined
            }
            onChange={(event) => {
              setPattern(event.target.value);
              setInvalid(false);
            }}
            placeholder={t("settings.browser.sitePatternPlaceholder")}
            className="min-w-40 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-ring"
          />
          <button
            type="submit"
            className={BROWSER_SETTINGS_BUTTON}
            disabled={disabled}
          >
            {t(
              editingPattern === null
                ? "settings.browser.add"
                : "settings.browser.save",
            )}
          </button>
          <button
            type="button"
            className={BROWSER_SETTINGS_BUTTON}
            disabled={disabled}
            onClick={() => {
              setAdding(false);
              setEditingPattern(null);
            }}
          >
            {t("settings.browser.cancel")}
          </button>
          {invalid ? (
            <p
              id="browser-site-pattern-error"
              role="alert"
              className="w-full text-xs text-destructive"
            >
              {t("settings.browser.invalidPattern")}
            </p>
          ) : null}
          {removed ? (
            <p
              id="browser-site-rule-removed"
              role="alert"
              className="w-full text-xs text-destructive"
            >
              {t("settings.browser.error.ruleRemoved")}
            </p>
          ) : null}
        </form>
      ) : null}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-border text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-3 font-normal">
                {t("settings.browser.websitePattern")}
              </th>
              {actions.map((action) => (
                <th key={action} scope="col" className="px-2 py-3 font-normal">
                  {t(`settings.browser.permissionAction.${action}`)}
                </th>
              ))}
              <th scope="col" className="w-16 px-2 py-2">
                <div className="flex justify-end">
                  <button
                    type="button"
                    className="rounded p-1 hover:bg-muted disabled:opacity-30"
                    disabled={page === 0}
                    aria-label={t("settings.browser.previousPermissions")}
                    onClick={() => setPage(page - 1)}
                  >
                    <ChevronLeft className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="rounded p-1 hover:bg-muted disabled:opacity-30"
                    disabled={
                      (page + 1) * 2 >= BROWSER_PERMISSION_ACTIONS.length
                    }
                    aria-label={t("settings.browser.nextPermissions")}
                    onClick={() => setPage(page + 1)}
                  >
                    <ChevronRight className="size-3.5" />
                  </button>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {[{ pattern: "", permissions: value.default }, ...sites].map(
              (site, index) => {
                const name =
                  index === 0 ? t("settings.browser.default") : site.pattern;
                const managed =
                  index > 0 &&
                  (browserPermissionRowManaged(
                    settings,
                    context,
                    site.pattern,
                  ) ||
                    (context !== null &&
                      !context.userPermissions.sites.some(
                        (entry) => entry.pattern === site.pattern,
                      )));
                return (
                  <tr
                    key={site.pattern}
                    className="border-b border-border last:border-0"
                  >
                    <th
                      scope="row"
                      className="max-w-52 truncate px-3 py-3 font-normal"
                      title={name}
                    >
                      {name}
                    </th>
                    {actions.map((action) => (
                      <td key={action} className="px-2 py-3">
                        <BrowserSitePermissionSelect
                          settings={settings}
                          context={context}
                          action={action}
                          pattern={site.pattern}
                          name={name}
                          disabled={disabled}
                          onChange={(permission) => {
                            const permissions = {
                              ...site.permissions,
                              [action]: permission,
                            };
                            void onChange(
                              index === 0
                                ? {
                                    ...value,
                                    default: permissions as BrowserPermissions,
                                  }
                                : {
                                    ...value,
                                    sites: value.sites.map((entry) =>
                                      entry.pattern === site.pattern
                                        ? { ...entry, permissions }
                                        : entry,
                                    ),
                                  },
                              value,
                            );
                          }}
                        />
                      </td>
                    ))}
                    <td className="px-2 py-3 text-right">
                      {index > 0 ? (
                        <div className="flex justify-end">
                          <button
                            type="button"
                            className="rounded p-1.5 hover:bg-muted"
                            disabled={disabled || managed}
                            title={
                              managed
                                ? t("settings.browser.sitePermissions.managed")
                                : undefined
                            }
                            aria-label={t("settings.browser.editSite", {
                              site: name,
                            })}
                            onClick={() => {
                              if (disabled || managed) return;
                              setEditingPattern(site.pattern);
                              setPattern(site.pattern);
                              setAdding(true);
                              setInvalid(false);
                              setRemoved(false);
                              setBaseline(value);
                            }}
                          >
                            <Pencil className="size-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="rounded p-1.5 hover:bg-muted"
                            disabled={disabled || managed}
                            title={
                              managed
                                ? t("settings.browser.sitePermissions.managed")
                                : undefined
                            }
                            aria-label={t("settings.browser.removeSite", {
                              site: name,
                            })}
                            onClick={() => {
                              if (disabled || managed) return;
                              void onChange(
                                {
                                  ...value,
                                  sites: value.sites.filter(
                                    (entry) => entry.pattern !== site.pattern,
                                  ),
                                },
                                value,
                              );
                            }}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              },
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("settings.browser.siteExceptionsOnly")}
      </p>
    </section>
  );
}
