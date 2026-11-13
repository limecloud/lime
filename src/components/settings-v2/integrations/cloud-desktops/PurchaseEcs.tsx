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
import { EcsSystemImages, type EcsSystemImage } from "./EcsSystemImages";
import type { CloudGuestPreparationStatus } from "@/lib/desktop-host/cloudDesktopConnection";
import { prepareCloudRuntimeRelease } from "./prepareCloudRuntimeRelease";

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
  restoring = false,
  systemImage,
  onSystemImage,
}: {
  purchase: ReturnType<typeof useCloudPurchase<EcsDesktopSpec>>;
  onBusyChange: (busy: boolean) => void;
  preparing: boolean;
  restoring?: boolean;
  systemImage?: EcsSystemImage;
  onSystemImage?: (image: EcsSystemImage | undefined) => void;
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
  const [runtimeProgress, setRuntimeProgress] =
    useState<CloudGuestPreparationStatus>();
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
  const selectSystemImage = useCallback(
    (image: EcsSystemImage | undefined) => {
      setQuote(undefined);
      setApproved(false);
      onSystemImage?.(image);
    },
    [setQuote, setApproved, onSystemImage],
  );
  useEffect(() => {
    setRuntimeUnavailable(false);
    setWithoutRuntime(false);
  }, [spec.profile, spec.regionId, spec.imageId]);
  const locked =
    pending || checkingRuntime || preparing || authorizing || planning;
  useEffect(() => {
    const value = currentPurchase.current;
    if (
      restoring &&
      systemImage &&
      !value.submitted &&
      value.spec.instanceType &&
      value.spec.vSwitchId &&
      value.spec.securityGroupId
    )
      void value.run("quote");
  }, [restoring, systemImage]);
  const context = () => {
    const value = currentPurchase.current;
    return JSON.stringify([value.spec, value.name, value.quote?.quoteId]);
  };
  const run: typeof purchase.run = async (action, template) => {
    if (action !== "purchase") return purchase.run(action, template);
    if (restoring && !systemImage) return;
    if (checking.current || locked || submitted || !purchase.canPurchase)
      return;
    checking.current = true;
    const original = context();
    onBusyChange(true);
    try {
      if (!withoutRuntime && !restoring) {
        setRuntimeUnavailable(false);
        setCheckingRuntime(true);
        setRuntimeProgress(undefined);
        if (
          !(await prepareCloudRuntimeRelease(
            () => active.current && original === context(),
            setRuntimeProgress,
            { profile: spec.profile, regionId: spec.regionId },
          ))
        )
          return;
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
      {!restoring && (
        <p className="mb-4 text-[13px] text-muted-foreground">
          {t("settings.cloudDesktop.ecsPurchaseDescription")}
        </p>
      )}
      <fieldset
        disabled={locked || submitted}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        {(["regionId"] as const).map((key) => (
          <Field key={key} name={key}>
            <CloudSelect
              value={spec[key]}
              onChange={(e) => {
                onSystemImage?.(undefined);
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
            onSystemImage?.(undefined);
            setSpec({ ...initialEcsSpec, profile, regionId: spec.regionId });
            setQuote(undefined);
            setApproved(false);
          }}
        />
      </div>
      {restoring && !submitted && (
        <div className="my-4">
          <EcsSystemImages
            profile={spec.profile}
            regionId={spec.regionId}
            disabled={locked}
            onSelected={selectSystemImage}
          />
        </div>
      )}
      {(!restoring || systemImage) && (
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
      )}
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
                onSystemImage?.(undefined);
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
                onSystemImage?.(undefined);
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
                readOnly={restoring && key === "imageId"}
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
      {checkingRuntime && (
        <div
          role="status"
          className="mt-3 space-y-1 text-[13px] text-muted-foreground"
        >
          <p>
            {t(
              runtimeProgress?.phase === "distributing"
                ? "settings.cloudDesktop.purchaseRuntimeDistributing"
                : "settings.cloudDesktop.purchaseRuntimePreparing",
            )}
          </p>
          {runtimeProgress?.receivedBytes !== undefined &&
            runtimeProgress.totalBytes !== undefined && (
              <p>
                {t("settings.cloudDesktop.installTransferBytes", {
                  received: (runtimeProgress.receivedBytes / 1024 ** 2).toFixed(
                    1,
                  ),
                  total: (runtimeProgress.totalBytes / 1024 ** 2).toFixed(1),
                })}
              </p>
            )}
        </div>
      )}
      {purchase.quote && !restoring && !withoutRuntime && (
        <p className="mt-3 text-[13px] text-muted-foreground">
          {t("settings.cloudDesktop.runtimeDistributionCost")}
        </p>
      )}
      <PurchaseActions
        purchase={{
          ...purchase,
          pending: locked || (restoring && !systemImage && !submitted),
          canPurchase: purchase.canPurchase && (!restoring || !!systemImage),
          run,
        }}
        pendingLabel={
          checkingRuntime
            ? t("settings.cloudDesktop.purchaseRuntimeChecking")
            : undefined
        }
      />
    </SettingsSection>
  );
}
