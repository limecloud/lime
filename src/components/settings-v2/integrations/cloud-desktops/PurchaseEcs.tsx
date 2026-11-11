import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { EcsDesktopSpec } from "@limecloud/app-server-client";
import { SettingsSection } from "../../SettingsPrimitives";
import { CloudSelect, Field, inputClass } from "./CloudDesktopPrimitives";
import { PurchaseActions } from "./PurchaseActions";
import type { useCloudPurchase } from "./useCloudPurchase";
import { EcsPurchaseTemplates } from "./EcsPurchaseTemplates";
import { AlibabaConnection } from "./AlibabaConnection";
import { initialEcsSpec } from "./purchaseSpecs";

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
  return (
    <SettingsSection>
      <p className="mb-4 text-[13px] text-muted-foreground">
        {t("settings.cloudDesktop.ecsPurchaseDescription")}
      </p>
      <fieldset
        disabled={pending || submitted || preparing || authorizing}
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
          locked={pending || submitted || preparing}
          onAuthorizingChange={setAuthorizing}
          onConnected={(profile) => {
            setSpec({ ...initialEcsSpec, profile, regionId: spec.regionId });
            setQuote(undefined);
            setApproved(false);
          }}
        />
      </div>
      <div className="my-4">
        <EcsPurchaseTemplates purchase={purchase} onBusyChange={onBusyChange} />
      </div>
      <details>
        <summary className="w-fit cursor-pointer py-2 text-[13px]">
          {t("settings.cloudDesktop.advancedPurchase")}
        </summary>
        <fieldset
          disabled={pending || submitted || preparing || authorizing}
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
      <PurchaseActions
        purchase={{ ...purchase, pending: pending || preparing || authorizing }}
      />
    </SettingsSection>
  );
}
