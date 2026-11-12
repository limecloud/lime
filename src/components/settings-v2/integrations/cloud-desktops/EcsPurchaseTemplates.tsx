import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EcsDesktopSpec } from "@limecloud/app-server-client";
import { requestCloudDesktop } from "@/lib/api/cloud";
import { SettingsAction } from "../../SettingsPrimitives";
import { CloudSelect } from "./CloudDesktopPrimitives";
import { object } from "./cloudDesktopData";
import type { useCloudPurchase } from "./useCloudPurchase";
import { EcsRecommendedPurchase } from "./EcsRecommendedPurchase";

type Template = { id: string; name: string; version: number };

export function EcsPurchaseTemplates({
  purchase,
  onBusyChange,
  onPreparationBusyChange,
}: {
  purchase: ReturnType<typeof useCloudPurchase<EcsDesktopSpec>>;
  onBusyChange: (busy: boolean) => void;
  onPreparationBusyChange: (busy: boolean) => void;
}) {
  const { t } = useTranslation("settings");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState("");
  const [pending, setPending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const current = useRef(purchase);
  current.current = purchase;
  const { profile, regionId } = purchase.spec;
  useEffect(() => {
    let cancelled = false;
    setTemplates([]);
    setSelected("");
    setLoaded(false);
    setError("");
    if (!profile || !regionId || current.current.submitted) return;
    current.current.setQuote(undefined);
    current.current.setApproved(false);
    setPending(true);
    onBusyChange(true);
    async function load() {
      try {
        const data = object(
          (
            await requestCloudDesktop({
              action: "listEcsTemplates",
              profile,
              regionId,
            })
          ).data,
        );
        if (!Array.isArray(data.templates))
          throw new Error("Invalid template response");
        const ids = new Set<string>();
        const list = data.templates.map((value) => {
          const item = object(value);
          if (
            typeof item.id !== "string" ||
            !item.id ||
            ids.has(item.id) ||
            typeof item.name !== "string" ||
            !Number.isSafeInteger(item.version) ||
            Number(item.version) < 1
          )
            throw new Error("Invalid template response");
          ids.add(item.id);
          return {
            id: item.id,
            name: item.name,
            version: Number(item.version),
          };
        });
        if (cancelled) return;
        setTemplates(list);
        setLoaded(true);
        if (list.length === 1) {
          setSelected(list[0].id);
          void current.current.run("quote", list[0]);
        }
      } catch {
        if (!cancelled)
          setError(t("settings.cloudDesktop.templatesUnavailable"));
      } finally {
        if (!cancelled) {
          setPending(false);
          onBusyChange(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
      onBusyChange(false);
    };
  }, [profile, regionId, refresh, onBusyChange, t]);

  const locked = pending || purchase.pending || purchase.submitted;
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted-foreground">
        {t("settings.cloudDesktop.templateDescription")}
      </p>
      {templates.length > 0 && (
        <label className="block space-y-1 text-[13px]">
          <span>{t("settings.cloudDesktop.purchaseTemplate")}</span>
          <CloudSelect
            value={selected}
            disabled={locked}
            onChange={(event) => {
              const template = templates.find(
                (item) => item.id === event.target.value,
              );
              setSelected(event.target.value);
              purchase.setQuote(undefined);
              purchase.setApproved(false);
              if (template) void purchase.run("quote", template);
            }}
          >
            <option value="">
              {t("settings.cloudDesktop.chooseTemplate")}
            </option>
            {templates.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} v{item.version}
              </option>
            ))}
          </CloudSelect>
        </label>
      )}
      {pending && (
        <p role="status" className="text-[13px]">
          {t("settings.cloudDesktop.working")}
        </p>
      )}
      {loaded && templates.length === 0 && (
        <p role="status" className="text-[13px] text-muted-foreground">
          {t("settings.cloudDesktop.noTemplates")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}
      {(error || (loaded && !templates.length)) && (
        <>
          <EcsRecommendedPurchase
            purchase={purchase}
            onBusyChange={onPreparationBusyChange}
          />
          <SettingsAction
            disabled={locked}
            onClick={() => setRefresh((value) => value + 1)}
          >
            {t("settings.cloudDesktop.loadTemplates")}
          </SettingsAction>
        </>
      )}
    </div>
  );
}
