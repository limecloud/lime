import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CloudDesktopResource } from "@limecloud/app-server-client";
import { apiKeyProviderApi } from "@/lib/api/apiKeyProvider";
import { configureCloudDesktopConnection } from "@/lib/api/cloudDesktopConnection";
import type { CloudModelConnectionStatus } from "@/lib/desktop-host/cloudDesktopConnection";
import { SettingsAction } from "../../SettingsPrimitives";
import { inputClass } from "./CloudDesktopPrimitives";

type Choice = { providerId: string; keyId: string; label: string };

/** 只选择本机已有连接；密钥交付与恢复由 Main 和两个 Provider owner 负责。 */
export function CloudModelConnection({
  resource,
  disabled,
}: {
  resource: CloudDesktopResource;
  disabled: boolean;
}) {
  const { t } = useTranslation("settings");
  const [open, setOpen] = useState(false);
  return (
    <details
      className="space-y-3 border-t border-border pt-4 text-[13px]"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer">
        {t("settings.cloudDesktop.modelShareTitle")}
      </summary>
      {open && (
        <CloudModelConnectionState resource={resource} disabled={disabled} />
      )}
    </details>
  );
}

function CloudModelConnectionState({
  resource,
  disabled,
}: {
  resource: CloudDesktopResource;
  disabled: boolean;
}) {
  const { t } = useTranslation("settings");
  const [choices, setChoices] = useState<Choice[]>([]);
  const [selected, setSelected] = useState("");
  const [state, setState] = useState<CloudModelConnectionStatus>();
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const busy = useRef(false);
  useEffect(() => {
    const current = ++generation.current;
    setPending(true);
    setFailed(false);
    setConsent(false);
    void Promise.allSettled([
      apiKeyProviderApi.getProviders({ forceRefresh: true }),
      configureCloudDesktopConnection({
        action: "modelConnectionStatus",
        resource,
      }),
    ])
      .then(([providersResult, statusResult]) => {
        if (current !== generation.current) return;
        if (statusResult.status !== "fulfilled")
          throw new Error("status unavailable");
        const result = statusResult.value;
        if (!("kind" in result) || result.kind !== "modelConnection")
          throw new Error("invalid status");
        const providers =
          providersResult.status === "fulfilled" ? providersResult.value : [];
        if (providersResult.status !== "fulfilled") setFailed(true);
        const options = providers
          .filter((p) => p.enabled)
          .flatMap((p) =>
            p.api_keys
              .filter((k) => k.enabled)
              .map((k) => ({
                providerId: p.id,
                keyId: k.id,
                label: `${p.name} / ${k.alias || k.api_key_masked}`,
              })),
          );
        setChoices(options);
        setSelected(result.keyId ?? options[0]?.keyId ?? "");
        setState(result);
      })
      .catch(() => {
        if (current === generation.current) setFailed(true);
      })
      .finally(() => {
        if (current === generation.current) setPending(false);
      });
    return () => {
      generation.current = current + 1;
    };
  }, [resource, attempt]);

  const unresolved =
    !!state && !["idle", "complete", "expired"].includes(state.phase);
  const choice = choices.find((value) => value.keyId === selected);
  const completed = state?.phase === "complete" && state.keyId === selected;
  async function execute() {
    if (busy.current || pending || disabled || !state) return;
    if (!unresolved && (!choice || !consent)) return;
    const current = generation.current;
    busy.current = true;
    setPending(true);
    setFailed(false);
    try {
      const result = await configureCloudDesktopConnection(
        unresolved && state.operationId
          ? {
              action: "resumeModelConnection",
              resource,
              operationId: state.operationId,
            }
          : {
              action: "shareModelConnection",
              resource,
              providerId: choice!.providerId,
              keyId: choice!.keyId,
              confirmation: `share-model:${resource.regionId}:${resource.resourceId}:${choice!.providerId}:${choice!.keyId}`,
            },
      );
      if (!("kind" in result) || result.kind !== "modelConnection")
        throw new Error("invalid status");
      if (current === generation.current) {
        setState(result);
        setConsent(false);
      }
    } catch {
      if (current !== generation.current) return;
      setFailed(true);
      try {
        const result = await configureCloudDesktopConnection({
          action: "modelConnectionStatus",
          resource,
        });
        if (
          current === generation.current &&
          "kind" in result &&
          result.kind === "modelConnection"
        )
          setState(result);
      } catch {
        /* 保留原状态，不把未知结果投影成未提交。 */
      }
    } finally {
      busy.current = false;
      if (current === generation.current) setPending(false);
    }
  }

  return (
    <section
      className="space-y-3 text-[13px]"
      aria-label={t("settings.cloudDesktop.modelShareTitle")}
    >
      <p className="text-muted-foreground">
        {t("settings.cloudDesktop.modelShareHelp")}
      </p>
      {pending && <p role="status">{t("settings.cloudDesktop.working")}</p>}
      {state && !unresolved && choices.length > 0 && (
        <label className="block space-y-1">
          <span>{t("settings.cloudDesktop.modelShareChoice")}</span>
          <select
            className={`${inputClass} w-full min-w-0`}
            value={selected}
            disabled={disabled || pending}
            onChange={(event) => {
              setSelected(event.target.value);
              setConsent(false);
            }}
          >
            {choices.map((value) => (
              <option key={value.keyId} value={value.keyId}>
                {value.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {state && !unresolved && !completed && choice && (
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5 shrink-0"
            checked={consent}
            disabled={disabled || pending}
            onChange={(event) => setConsent(event.target.checked)}
          />
          <span>{t("settings.cloudDesktop.modelShareConsent")}</span>
        </label>
      )}
      {!pending && state && !unresolved && choices.length === 0 && (
        <p>{t("settings.cloudDesktop.modelShareEmpty")}</p>
      )}
      {unresolved && (
        <p role="status">{t("settings.cloudDesktop.modelShareRecovery")}</p>
      )}
      {completed && (
        <p role="status">{t("settings.cloudDesktop.modelShareComplete")}</p>
      )}
      {state?.phase === "expired" && (
        <p role="status">{t("settings.cloudDesktop.modelShareExpired")}</p>
      )}
      {failed && (
        <p role="alert" className="text-destructive">
          {t("settings.cloudDesktop.modelShareFailed")}
        </p>
      )}
      {state?.operationId && (
        <p className="break-all select-text text-[12px] text-muted-foreground">
          {t("settings.cloudDesktop.operationId")}: {state.operationId}
        </p>
      )}
      {!completed && (
        <SettingsAction
          disabled={
            disabled ||
            pending ||
            !state ||
            (!unresolved && (!choice || !consent))
          }
          onClick={() => void execute()}
        >
          {t(
            `settings.cloudDesktop.${unresolved ? "resumeOperation" : "modelShareAction"}`,
          )}
        </SettingsAction>
      )}
      {failed && !unresolved && (
        <SettingsAction
          disabled={pending}
          onClick={() => setAttempt((value) => value + 1)}
        >
          {t("settings.cloudDesktop.refresh")}
        </SettingsAction>
      )}
    </section>
  );
}
