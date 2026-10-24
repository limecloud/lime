import { useId } from "react";
import { LockKeyhole } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  BrowserPermissionAction,
  BrowserSettings,
  BrowserSitePermission,
} from "@/lib/api/browserSettings";
import {
  browserSitePermissionCell,
  type BrowserPermissionContext,
} from "@/lib/api/browserUsePolicySitePermissions";

export function BrowserSitePermissionSelect({
  settings,
  context,
  action,
  pattern,
  name,
  disabled,
  onChange,
}: {
  settings: BrowserSettings;
  context: BrowserPermissionContext | null;
  action: BrowserPermissionAction;
  pattern: string;
  name: string;
  disabled: boolean;
  onChange: (value: BrowserSitePermission) => void;
}) {
  const { t } = useTranslation("settings");
  const descriptionId = useId();
  const cell = browserSitePermissionCell(settings, context, action, pattern);
  const value = pattern
    ? (settings.agent_permissions.sites.find((site) => site.pattern === pattern)
        ?.permissions[action] ?? "default")
    : settings.agent_permissions.default[action];
  const modes = {
    browse: settings.approvalMode,
    download: settings.downloadApprovalMode,
    upload: settings.uploadApprovalMode,
  };
  const askUnavailable = Boolean(
    pattern &&
    action in modes &&
    modes[action as keyof typeof modes] === "neverAsk",
  );
  const options = (["default", "ask", "allow", "deny"] as const).filter(
    (option) =>
      (option !== "default" || pattern) &&
      (option !== "ask" || (action !== "debug" && action !== "site_tools")),
  );
  const locked = disabled || Boolean(cell.disabledReason);
  const effectiveLabel = t(
    `settings.browser.permission.${cell.effectiveValue}`,
  );
  const explanation = [
    cell.disabledReason
      ? t(`settings.browser.sitePermissions.${cell.disabledReason}`)
      : null,
    cell.inheritedRestriction === "organization" &&
    cell.disabledReason !== "managed"
      ? t("settings.browser.sitePermissions.organizationRestriction")
      : cell.inheritedRestriction && !cell.blockingPattern
        ? t("settings.browser.sitePermissions.defaultPolicyRestriction")
        : null,
    cell.blockingPattern
      ? t("settings.browser.sitePermissions.blockingRuleDescription", {
          pattern: cell.blockingPattern,
        })
      : null,
    cell.inherited
      ? t("settings.browser.sitePermissions.inheritedDescription")
      : null,
  ]
    .filter(Boolean)
    .join(" ");
  const showEffective = value !== "default" && value !== cell.effectiveValue;
  const described = Boolean(explanation || showEffective);
  return (
    <div className="max-w-56 space-y-1">
      <div className="flex items-center gap-1">
        {cell.disabledReason ? (
          <LockKeyhole
            className="size-3 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        ) : null}
        <select
          value={value}
          data-browser-permission-action={action}
          data-browser-permission-pattern={pattern}
          data-browser-permission-effective={cell.effectiveValue}
          disabled={locked}
          aria-label={`${name} · ${t(`settings.browser.permissionAction.${action}`)}`}
          aria-describedby={described ? descriptionId : undefined}
          title={explanation || undefined}
          className={`min-w-max max-w-full rounded-lg border border-border bg-background py-1.5 pl-2 pr-7 text-xs focus-visible:outline-ring disabled:opacity-50 ${cell.inherited ? "text-muted-foreground" : ""}`}
          onChange={(event) => {
            const next = event.target.value as BrowserSitePermission;
            if (
              locked ||
              !options.includes(next) ||
              (next === "ask" && askUnavailable)
            )
              return;
            onChange(next);
          }}
        >
          {options.map((option) => (
            <option
              key={option}
              value={option}
              disabled={option === "ask" && askUnavailable}
              title={
                option === "ask" && askUnavailable
                  ? t("settings.browser.changeDefaultBeforeAsk")
                  : undefined
              }
            >
              {option === "default" && value === "default"
                ? t("settings.browser.sitePermissions.inheritedValue", {
                    value: effectiveLabel,
                  })
                : t(`settings.browser.permission.${option}`)}
            </option>
          ))}
        </select>
      </div>
      {described ? (
        <p
          id={descriptionId}
          className="text-[11px] leading-4 text-muted-foreground"
        >
          {showEffective
            ? t("settings.browser.sitePermissions.effectiveValue", {
                value: effectiveLabel,
              })
            : null}
          {explanation ? (
            <span className={showEffective ? "block" : undefined}>
              {explanation}
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
