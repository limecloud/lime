import { initialWuyingSpec } from "./purchaseSpecs";
import type { useCloudPurchase } from "./useCloudPurchase";
import { PurchaseActions } from "./PurchaseActions";
import { useTranslation } from "react-i18next";
import type { WuyingDesktopSpec } from "@limecloud/app-server-client";
import { SettingsSection } from "../../SettingsPrimitives";
import { Field, inputClass } from "./CloudDesktopPrimitives";

export function PurchaseWuying({
  purchase,
}: {
  purchase: ReturnType<typeof useCloudPurchase<WuyingDesktopSpec>>;
}) {
  const { t } = useTranslation("settings");
  const {
    spec,
    setSpec,
    name,
    setName,
    setQuote,
    setApproved,
    pending,
    submitted,
  } = purchase;
  return (
    <SettingsSection>
      <p className="mb-4 text-[13px] text-muted-foreground">
        {t("settings.cloudDesktop.purchaseDescription")}
      </p>
      <fieldset
        disabled={pending || submitted}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
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
            "profile",
            "regionId",
            "officeSiteId",
            "endUserId",
            "policyGroupId",
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
            {(
              [
                "desktopType",
                "imageId",
                "systemDiskGib",
                "dataDiskGib",
              ] as const
            ).map((key) => (
              <Field key={key} name={key}>
                <input
                  className={inputClass}
                  value={spec[key]}
                  type={
                    typeof initialWuyingSpec[key] === "number"
                      ? "number"
                      : "text"
                  }
                  min={0}
                  onChange={(e) => {
                    setSpec({
                      ...spec,
                      [key]:
                        typeof initialWuyingSpec[key] === "number"
                          ? Number(e.target.value)
                          : e.target.value,
                    });
                    setQuote(undefined);
                    setApproved(false);
                  }}
                />
              </Field>
            ))}
          </div>
        </details>
      </fieldset>
      <PurchaseActions purchase={purchase} />
    </SettingsSection>
  );
}
