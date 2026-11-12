import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EcsDesktopSpec } from "@limecloud/app-server-client";
import { SettingsSection } from "../../SettingsPrimitives";
import { CloudSelect, Field, inputClass } from "./CloudDesktopPrimitives";
import { PurchaseActions } from "./PurchaseActions";
import type { useCloudPurchase } from "./useCloudPurchase";
import { EcsPurchaseTemplates } from "./EcsPurchaseTemplates";
import { AlibabaConnection } from "./AlibabaConnection";
import { initialEcsSpec } from "./purchaseSpecs";
import { EcsSystemImages } from "./EcsSystemImages";
import { configureCloudDesktopConnection } from "@/lib/api/cloudDesktopConnection";

const regions = [
  "cn-hangzhou",
  "cn-shanghai",
  "cn-beijing",
  "cn-shenzhen",
  "cn-guangzhou",
  "ap-southeast-1",
];

export function PurchaseEcs({
  purchase,
  onBusyChange,
  preparing,
}: {
  purchase: ReturnType<typeof useCloudPurchase<EcsDesktopSpec>>;
  onBusyChange: (busy: boolean) => void;
  preparing: boolean;
}) {
  const { t } = useTranslation("settings");
  const [authorizing, setAuthorizing] = useState(false);
  const [planning, setPlanning] = useState(false);
  const onPreparationBusyChange = useCallback(
    (busy: boolean) => {
      setPlanning(busy);
      onBusyChange(busy);
    },
    [onBusyChange],
  );
  const [checkingRuntime, setCheckingRuntime] = useState(false);
  const [runtimeUnavailable, setRuntimeUnavailable] = useState(false);
  const [withoutRuntime, setWithoutRuntime] = useState(false);
  const checking = useRef(false);
  const active = useRef(true);
  const currentPurchase = useRef(purchase);
  currentPurchase.current = purchase;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const {
    spec,
    setSpec,
    name,
    setName,
    pending,
    submitted,
    setQuote,
    setApproved,
  } = purchase;
  useEffect(() => {
    setRuntimeUnavailable(false);
    setWithoutRuntime(false);
  }, [spec.profile, spec.regionId, spec.imageId]);
  const locked =
    pending || checkingRuntime || preparing || authorizing || planning;
  const context = () => {
    const value = currentPurchase.current;
    return JSON.stringify([value.spec, value.name, value.quote?.quoteId]);
  };
  const run: typeof purchase.run = async (action, template) => {
    if (action !== "purchase") return purchase.run(action, template);
    if (checking.current || locked || submitted || !purchase.canPurchase)
      return;
    checking.current = true;
    const original = context();
    onBusyChange(true);
    try {
      if (!withoutRuntime) {
        setRuntimeUnavailable(false);
        setCheckingRuntime(true);
        const result = await configureCloudDesktopConnection({
          action: "checkRuntimeRelease",
        });
        if (
          !("kind" in result) ||
          result.kind !== "guestRelease" ||
          !result.available
        )
          throw new Error("Unavailable runtime");
      }
      if (!active.current || original !== context()) return;
      setRuntimeUnavailable(false);
      setWithoutRuntime(false);
      setCheckingRuntime(false);
      await currentPurchase.current.run("purchase");
    } catch {
      if (active.current && original === context()) setRuntimeUnavailable(true);
    } finally {
      checking.current = false;
      if (active.current) {
        setCheckingRuntime(false);
        onBusyChange(false);
      }
    }
  };
  return (
    <SettingsSection>
      <p className="mb-4 text-[13px] text-muted-foreground">
        {t("settings.cloudDesktop.ecsPurchaseDescription")}
      </p>
      <fieldset
        disabled={locked || submitted}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        {(["regionId"] as const).map((key) => (
          <Field key={key} name={key}>
            <CloudSelect
              value={spec[key]}
              onChange={(e) => {
                setSpec({
                  ...initialEcsSpec,
                  profile: spec.profile,
                  [key]: e.target.value,
                });
                setQuote(undefined);
                setApproved(false);
              }}
            >
              {regions.map((region) => (
                <option key={region} value={region}>
                  {t(`settings.cloudDesktop.regions.${region}`)}
                </option>
              ))}
              {!regions.includes(spec.regionId) && (
                <option value={spec.regionId}>{spec.regionId}</option>
              )}
            </CloudSelect>
          </Field>
        ))}
      </fieldset>
      <div className="my-4">
        <AlibabaConnection
          regionId={spec.regionId}
          profile={spec.profile}
          locked={
            pending || checkingRuntime || submitted || preparing || planning
          }
          onAuthorizingChange={setAuthorizing}
          onConnected={(profile) => {
            setSpec({ ...initialEcsSpec, profile, regionId: spec.regionId });
            setQuote(undefined);
            setApproved(false);
          }}
        />
      </div>
      <div className="my-4">
        <EcsPurchaseTemplates
          purchase={{
            ...purchase,
            pending: pending || checkingRuntime || planning,
          }}
          onBusyChange={onBusyChange}
          onPreparationBusyChange={onPreparationBusyChange}
        />
      </div>
      <div className="my-4">
        <EcsSystemImages purchase={purchase} disabled={locked} />
      </div>
      <details>
        <summary className="w-fit cursor-pointer py-2 text-[13px]">
          {t("settings.cloudDesktop.advancedPurchase")}
        </summary>
        <fieldset
          disabled={locked || submitted}
          className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          <Field name="profile">
            <input
              className={inputClass}
              value={spec.profile}
              onChange={(e) => {
                setSpec({
                  ...initialEcsSpec,
                  profile: e.target.value,
                  regionId: spec.regionId,
                });
                setQuote(undefined);
                setApproved(false);
              }}
            />
          </Field>
          <Field name="regionId">
            <input
              className={inputClass}
              value={spec.regionId}
              onChange={(e) => {
                setSpec({
                  ...initialEcsSpec,
                  profile: spec.profile,
                  regionId: e.target.value,
                });
                setQuote(undefined);
                setApproved(false);
              }}
            />
          </Field>
          <Field name="desktopName">
            <input
              className={inputClass}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setApproved(false);
              }}
            />
          </Field>
          {(
            [
              "vSwitchId",
              "securityGroupId",
              "keyPairName",
              "instanceType",
              "imageId",
            ] as const
          ).map((key) => (
            <Field key={key} name={key}>
              <input
                className={inputClass}
                value={spec[key]}
                onChange={(e) => {
                  setSpec({ ...spec, [key]: e.target.value });
                  setQuote(undefined);
                  setApproved(false);
                }}
              />
            </Field>
          ))}
          <details className="sm:col-span-2">
            <summary className="w-fit cursor-pointer py-2 text-[13px]">
              {t("settings.cloudDesktop.machineSettings")}
            </summary>
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(["systemDiskGib", "outboundMbps"] as const).map((key) => (
                <Field key={key} name={key}>
                  <input
                    className={inputClass}
                    type="number"
                    min={key === "systemDiskGib" ? 60 : 1}
                    max={key === "systemDiskGib" ? 500 : 100}
                    value={spec[key]}
                    onChange={(e) => {
                      setSpec({ ...spec, [key]: Number(e.target.value) });
                      setQuote(undefined);
                      setApproved(false);
                    }}
                  />
                </Field>
              ))}
            </div>
          </details>
        </fieldset>
      </details>
      {purchase.quote && (
        <p className="mt-3 text-[13px]">
          {t("settings.cloudDesktop.templateSummary", {
            name,
            instance: spec.instanceType,
            disk: spec.systemDiskGib,
          })}
        </p>
      )}
      <p className="mt-3 text-[13px] text-muted-foreground">
        {t("settings.cloudDesktop.ecsEncryption")}
      </p>
      {runtimeUnavailable && !submitted && (
        <div className="mt-3 space-y-3 text-[13px]">
          <p role="alert" className="text-destructive">
            {t("settings.cloudDesktop.purchaseRuntimeUnavailable")}
          </p>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={withoutRuntime}
              disabled={locked}
              onChange={(event) => setWithoutRuntime(event.target.checked)}
            />
            {t("settings.cloudDesktop.purchaseWithoutRuntime")}
          </label>
        </div>
      )}
      <PurchaseActions
        purchase={{ ...purchase, pending: locked, run }}
        pendingLabel={
          checkingRuntime
            ? t("settings.cloudDesktop.purchaseRuntimeChecking")
            : undefined
        }
      />
    </SettingsSection>
  );
}
