import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, ExternalLink, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { openPathWithDefaultApp } from "@/lib/api/fileSystem";
import type { HookMetadata, HookStateUpdate } from "@/lib/api/hooks";
import { SettingsAction, SettingsSwitch } from "../../SettingsPrimitives";
import { needsHookReview } from "./hooks-settings-model";

export function HookRow({
  hook,
  index,
  disabled,
  update,
}: {
  hook: HookMetadata;
  index: number;
  disabled: boolean;
  update: (updates: HookStateUpdate[]) => Promise<void>;
}) {
  const { t, i18n } = useTranslation("settings");
  const [expanded, setExpanded] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const [opening, setOpening] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const id = useId();
  const review = needsHookReview(hook);
  const managed = hook.isManaged || hook.trustStatus === "managed";
  const statusMessage = hook.statusMessage?.trim();
  const label = statusMessage
    ? t("settings.hooks.numberedHookTitle", { index: index + 1, statusMessage })
    : t("settings.hooks.hookLabel", { index: index + 1 });
  return (
    <div className="border-t border-border" data-hook-key={hook.key}>
      <div className="flex min-w-0 items-center gap-2 py-2">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded(!expanded)}
          className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md py-1 pl-7 text-left text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="min-w-0 break-words">{label}</span>
          <ChevronDown
            aria-hidden
            className={`size-3 shrink-0 ${expanded ? "rotate-180" : ""}`}
          />
        </button>
        {!managed ? (
          <button
            type="button"
            aria-label={t("settings.hooks.openConfig")}
            title={t("settings.hooks.openConfig")}
            disabled={opening}
            onClick={() => {
              setOpening(true);
              setOpenFailed(false);
              void openPathWithDefaultApp(hook.sourcePath)
                .catch(() => {
                  if (mounted.current) setOpenFailed(true);
                })
                .finally(() => {
                  if (mounted.current) setOpening(false);
                });
            }}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <ExternalLink aria-hidden className="size-3.5" />
          </button>
        ) : null}
        {review && !managed ? (
          <SettingsAction
            type="button"
            disabled={disabled}
            title={t(`settings.hooks.status.${hook.trustStatus}`)}
            onClick={() =>
              void update([{ key: hook.key, trustedHash: hook.currentHash }])
            }
          >
            <ShieldCheck aria-hidden />
            {t("settings.hooks.trust")}
          </SettingsAction>
        ) : null}
        {managed ? (
          <span
            role="switch"
            tabIndex={0}
            aria-label={label}
            aria-checked="true"
            aria-disabled="true"
            title={t("settings.hooks.managed")}
            className="inline-flex rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <SettingsSwitch aria-hidden tabIndex={-1} checked disabled />
          </span>
        ) : (
          <SettingsSwitch
            aria-label={label}
            title={
              review
                ? t(`settings.hooks.status.${hook.trustStatus}`)
                : undefined
            }
            checked={hook.enabled && !review}
            disabled={disabled || review}
            onCheckedChange={(enabled) =>
              void update([{ key: hook.key, enabled }])
            }
          />
        )}
      </div>
      {openFailed ? (
        <p role="alert" className="pb-2 text-[13px] text-destructive">
          {t("settings.hooks.openFailed")}
        </p>
      ) : null}
      {expanded ? (
        <div id={id} className="pb-2 pl-7 text-[13px]">
          <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-md border border-border px-3 py-3 [&>dt]:text-muted-foreground [&>dd]:min-w-0">
            <dt>{t("settings.hooks.hookType")}</dt>
            <dd>{t(`settings.hooks.event.${hook.eventName}`)}</dd>
            {hook.handlerType === "command" ? (
              <>
                <dt>{t("settings.hooks.command")}</dt>
                <dd>
                  <code className="block break-all whitespace-pre-wrap font-mono text-[12px]">
                    {hook.command}
                  </code>
                </dd>
              </>
            ) : hook.handlerType === "mcpTool" ? (
              <>
                <dt>{t("settings.hooks.server")}</dt>
                <dd className="break-all font-mono text-[12px]">
                  {hook.server}
                </dd>
                <dt>{t("settings.hooks.tool")}</dt>
                <dd className="break-all font-mono text-[12px]">{hook.tool}</dd>
              </>
            ) : (
              <>
                <dt>{t("settings.hooks.handlerLabel")}</dt>
                <dd>{t(`settings.hooks.handler.${hook.handlerType}`)}</dd>
              </>
            )}
            {hook.matcher != null ? (
              <>
                <dt>{t("settings.hooks.matcher")}</dt>
                <dd className="break-all font-mono text-[12px]">
                  {hook.matcher}
                </dd>
              </>
            ) : null}
            <dt>{t("settings.hooks.timeout")}</dt>
            <dd>
              {new Intl.NumberFormat(i18n.resolvedLanguage || i18n.language, {
                style: "unit",
                unit: "second",
                unitDisplay: "narrow",
              }).format(hook.timeoutSec)}
            </dd>
          </dl>
        </div>
      ) : null}
    </div>
  );
}
